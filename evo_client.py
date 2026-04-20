"""
Cliente HTTP para la API de EVO (W12).
Replica el patrón usado por neo-ws (Ruby/Rails) en Python, para poder
consumir directamente desde el Flask sin depender del backend de NEO.

Endpoint base: https://evo-integracao-api.w12app.com.br
Auth: HTTP Basic (user:pass por país) + header fijo `neo-request`.

Variables de entorno requeridas:
  EVO_USERNAME      - usuario Basic Auth (por país, p.ej. Chile)
  EVO_PASSWORD      - password Basic Auth
  EVO_NEO_HEADER    - header neo-request (opcional; tiene default)
"""

import os
import base64
from datetime import datetime, timedelta
from typing import List, Dict, Optional

import requests
import pandas as pd


EVO_BASE_URL = "https://evo-integracao-api.w12app.com.br"

# Header fijo (mismo valor que usa neo-ws, no varía por país ni ambiente).
# Se puede sobreescribir vía env var EVO_NEO_HEADER si EVO la rota en el futuro.
DEFAULT_NEO_HEADER = "evo3jok123987k123123dY6Pq45"

# Acciones que cuentan para ocupación (iguales a las que filtra Evo::Branches#entries).
ENTRY_ACTIONS = ["entry", "output", "Manual Entry", "Blocked", "Manual Output"]

# Mapeo de entryAction (EVO) → acción en español (como viene en el Excel export).
# Esto permite reusar toda la lógica existente de process_excel sin cambios.
ACTION_MAP = {
    "entry": "Liberado",
    "Manual Entry": "Liberado",
    "output": "Saída",
    "Manual Output": "Saída",
    "Blocked": "Bloqueado",
}


class EvoAuthError(Exception):
    """Credenciales EVO inválidas o no configuradas."""


class EvoApiError(Exception):
    """Error HTTP genérico al llamar a EVO."""


def _auth_token() -> str:
    user = os.environ.get("EVO_USERNAME")
    pwd = os.environ.get("EVO_PASSWORD")
    if not user or not pwd:
        raise EvoAuthError(
            "Faltan EVO_USERNAME y/o EVO_PASSWORD en variables de entorno."
        )
    raw = f"{user}:{pwd}".encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def _headers() -> Dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Basic {_auth_token()}",
        "neo-request": os.environ.get("EVO_NEO_HEADER", DEFAULT_NEO_HEADER),
    }


# Tamaño de página para /api/v1/entries. EVO devuelve 50 por default si no se
# especifica `take`; con 500 cubre cómodo un día completo (gimnasio típico:
# 200-400 eventos/día). Si algún día se excede, el while loop pagina.
_PAGE_SIZE = 500
_MAX_PAGES = 20  # safety cap: 10.000 eventos


def fetch_entries(
    date_start: datetime,
    date_end: datetime,
    member_id: Optional[int] = None,
    actions: Optional[List[str]] = None,
    timeout: int = 30,
) -> List[Dict]:
    """
    GET /api/v1/entries?registerDateStart=...&registerDateEnd=...&take=...&skip=...
    Pagina automáticamente hasta consumir todo el rango.
    """
    if actions is None:
        actions = ENTRY_ACTIONS

    url = f"{EVO_BASE_URL}/api/v1/entries"
    all_entries: List[Dict] = []
    skip = 0
    pages = 0

    while pages < _MAX_PAGES:
        params = {
            "registerDateStart": date_start.strftime("%Y-%m-%dT%H:%M:%S"),
            "registerDateEnd": date_end.strftime("%Y-%m-%dT%H:%M:%S"),
            "take": _PAGE_SIZE,
            "skip": skip,
        }
        if member_id is not None:
            params["idMember"] = member_id

        try:
            r = requests.get(url, headers=_headers(), params=params, timeout=timeout)
        except requests.RequestException as e:
            raise EvoApiError(f"Fallo de red contra EVO: {e}") from e

        if r.status_code in (401, 403):
            raise EvoAuthError(
                f"EVO rechazó las credenciales (HTTP {r.status_code}). "
                "Verifica EVO_USERNAME / EVO_PASSWORD."
            )
        if not r.ok:
            raise EvoApiError(f"EVO devolvió HTTP {r.status_code}: {r.text[:300]}")

        try:
            data = r.json()
        except ValueError as e:
            raise EvoApiError(f"Respuesta no-JSON de EVO: {e}") from e

        if not isinstance(data, list):
            raise EvoApiError(f"Respuesta inesperada de EVO: {str(data)[:300]}")

        if not data:
            break  # no hay más páginas

        all_entries.extend(data)
        pages += 1
        if len(data) < _PAGE_SIZE:
            break  # última página
        skip += _PAGE_SIZE

    return [e for e in all_entries if e.get("entryAction") in actions]


def fetch_branches() -> List[Dict]:
    """GET /api/v1/configuration  — lista de sedes con idBranch/name."""
    url = f"{EVO_BASE_URL}/api/v1/configuration"
    r = requests.get(url, headers=_headers(), timeout=30)
    if not r.ok:
        raise EvoApiError(f"EVO devolvió HTTP {r.status_code}: {r.text[:300]}")
    return r.json()


def fetch_occupation() -> List[Dict]:
    """
    GET /api/v1/configuration/occupation — ocupación real-time autoritativa de EVO.
    Devuelve lista de {idBranch, name, occupation, maxOccupation, qtyMinutesOut}.
    Esta es la fuente de verdad para "cuántos hay adentro AHORA" — no depende
    de replay de eventos y matchea exactamente con lo que ve EVO en su panel.
    """
    url = f"{EVO_BASE_URL}/api/v1/configuration/occupation"
    r = requests.get(url, headers=_headers(), timeout=30)
    if not r.ok:
        raise EvoApiError(f"EVO devolvió HTTP {r.status_code}: {r.text[:300]}")
    return r.json()


def entries_to_dataframe(
    entries: List[Dict],
    sede_name: Optional[str] = None,
    branch_filter: Optional[int] = None,
) -> pd.DataFrame:
    """
    Convierte la respuesta de /api/v1/entries a un DataFrame con las MISMAS
    columnas que produce el export Excel de EVO, para que process_excel()
    lo procese sin cambios.

    Shape real de cada evento (verificado contra la API):
      date, dateTurn, timeZone, idMember, nameMember, idProspect, nameProspect,
      idEmployee, nameEmployee, entryType, device, releasesByID, idBranch,
      blockReason, entryAction, idMigration, idTurnstile

    Columnas producidas (match contra el Excel manual):
      - "Hora de acceso"      (ISO datetime)
      - "Acción"              (Liberado / Saída / Bloqueado)
      - "Nombre"              (nameMember, con fallback a nameEmployee/nameProspect/idMember)
      - "Sede de origen"      (sede_name override, o idBranch)
      - "Molinete/Torniquete" (sede_name, p.ej. "Interlaken" → lo necesita process_excel)
    """
    if branch_filter is not None:
        entries = [e for e in entries if e.get("idBranch") == branch_filter]

    rows = []
    for e in entries:
        action_es = ACTION_MAP.get(e.get("entryAction"), str(e.get("entryAction", "")))
        name = (
            e.get("nameMember")
            or e.get("nameEmployee")
            or e.get("nameProspect")
            or f"id:{e.get('idMember') or e.get('idEmployee') or e.get('idProspect') or '?'}"
        )
        rows.append({
            "Hora de acceso": e.get("date"),
            "Acción": action_es,
            "Nombre": str(name),
            "Sede de origen": sede_name or str(e.get("idBranch", "")),
            "Molinete/Torniquete": sede_name or "",
        })

    df = pd.DataFrame(rows)
    return df


def dataframe_to_excel_bytes(df: pd.DataFrame) -> bytes:
    """
    Serializa el DataFrame como XLSX en memoria, para reutilizar
    process_excel(file_bytes, capacity) tal cual.
    """
    from io import BytesIO
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as w:
        df.to_excel(w, index=False)
    return buf.getvalue()


def fetch_and_build_excel_bytes(
    hours: int = 24,
    sede_name: str = "Interlaken",
    branch_id: Optional[int] = None,
) -> bytes:
    """
    Conveniencia: trae las últimas N horas desde EVO y devuelve un XLSX
    con el mismo shape que un export manual. El Flask lo pasa directo a
    process_excel().
    """
    end = datetime.now()
    start = end - timedelta(hours=hours)
    entries = fetch_entries(start, end)
    df = entries_to_dataframe(entries, sede_name=sede_name, branch_filter=branch_id)
    return dataframe_to_excel_bytes(df)


def fetch_and_build_excel_bytes_from_today(
    start_hour: int = 6,
    sede_name: str = "Interlaken",
    branch_id: Optional[int] = None,
) -> bytes:
    """
    Trae eventos desde `start_hour` del día actual hasta ahora.
    Arranca en el horario de apertura del gym (default 6am) para que la
    deduplicación por persona comience con un estado limpio (el gimnasio
    está cerrado durante la noche, por lo tanto nadie "estaba adentro antes").
    Si la hora actual es anterior a start_hour (p.ej. 3am), usa start_hour
    del día anterior.
    """
    now = datetime.now()
    start = now.replace(hour=start_hour, minute=0, second=0, microsecond=0)
    if now < start:
        start -= timedelta(days=1)
    entries = fetch_entries(start, now)
    df = entries_to_dataframe(entries, sede_name=sede_name, branch_filter=branch_id)
    return dataframe_to_excel_bytes(df)
