"""
Script de verificación standalone para credenciales de EVO.

Uso:
    export EVO_USERNAME='tu_usuario'
    export EVO_PASSWORD='tu_password'
    python3 test_evo.py

Hace 3 pruebas incrementales:
    1) Llama a /api/v1/configuration (lista de sedes) → valida auth básica
    2) Llama a /api/v1/entries con rango de 1 hora hacia atrás → valida que
       el header neo-request hardcodeado sigue siendo aceptado
    3) Muestra un sample de 3 eventos para confirmar el shape de la respuesta

Si falla el paso 1 → credenciales Basic Auth malas.
Si falla el paso 2 pero el 1 pasa → hay que pedir un neo-request header nuevo.
"""

import os
import sys
from datetime import datetime, timedelta

import evo_client


def _check_env():
    missing = [v for v in ("EVO_USERNAME", "EVO_PASSWORD") if not os.environ.get(v)]
    if missing:
        print(f"✗ Faltan variables: {', '.join(missing)}")
        print("  Ejemplo:")
        print("    export EVO_USERNAME='...'")
        print("    export EVO_PASSWORD='...'")
        sys.exit(1)
    print(f"✓ Variables de entorno presentes (user: {os.environ['EVO_USERNAME']})")


def test_branches():
    print("\n[1/3] GET /api/v1/configuration — lista de sedes")
    try:
        branches = evo_client.fetch_branches()
    except evo_client.EvoAuthError as e:
        print(f"   ✗ Auth rechazada: {e}")
        print("   → Las credenciales Basic Auth no son válidas para esta cuenta.")
        sys.exit(2)
    except evo_client.EvoApiError as e:
        print(f"   ✗ Error: {e}")
        sys.exit(3)

    print(f"   ✓ OK — {len(branches)} sedes devueltas")
    for b in branches[:5]:
        print(f"     idBranch={b.get('idBranch')}  name={b.get('name')}")
    if len(branches) > 5:
        print(f"     ... ({len(branches) - 5} más)")
    return branches


def test_entries():
    print("\n[2/3] GET /api/v1/entries — última hora")
    end = datetime.now()
    start = end - timedelta(hours=1)
    try:
        entries = evo_client.fetch_entries(start, end)
    except evo_client.EvoAuthError as e:
        print(f"   ✗ Auth rechazada: {e}")
        print("   → El header neo-request puede estar rotado. Pedir uno nuevo.")
        sys.exit(4)
    except evo_client.EvoApiError as e:
        print(f"   ✗ Error: {e}")
        sys.exit(5)

    print(f"   ✓ OK — {len(entries)} eventos en la última hora")
    return entries


def sample_entries(entries):
    print("\n[3/3] Muestra de eventos (primeros 3)")
    if not entries:
        print("   (sin eventos en la ventana; probá subir el rango a 24h)")
        return
    for e in entries[:3]:
        print(f"   - {e.get('registerDate')}  "
              f"action={e.get('entryAction')}  "
              f"idMember={e.get('idMember')}  "
              f"idBranch={e.get('idBranch')}")


def main():
    print("=== Test de integración EVO ===")
    _check_env()
    test_branches()
    entries = test_entries()
    sample_entries(entries)
    print("\n✓ Todo OK. Las credenciales sirven para el Flask.")


if __name__ == "__main__":
    main()
