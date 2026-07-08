// Chat CLI interactivo con el bot. Combina:
//   - Menú de preguntas frecuentes agrupadas por sección (elegís por número)
//   - Modo libre (escribís lo que quieras y se manda al pipeline)
//
// Uso: yarn tsx scripts/chat.ts
// Comandos: número → preset · "menu" → re-mostrar lista · "exit" → salir
//
// ⚠️ Costo típico: ~$0.001-$0.002 por pregunta (embed + LLM si pasa gate 1).

import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { ask } from '../lib/ask.js';

interface Preset {
  section: string;
  question: string;
}

// Preguntas curadas que sabemos que el bot responde bien (verificadas con el
// eval del 2026-07-02). Podés editarlas / sumar / sacar sin tocar código.
const PRESETS: Preset[] = [
  // 💰 Precios
  { section: '💰 Precios', question: '¿Cómo funciona el precio del pase?' },
  { section: '💰 Precios', question: '¿Una clase puede costar menos que el pase?' },

  // 🔐 Accesos y QR
  { section: '🔐 Accesos y QR', question: "Al comprar sale 'tiempo agotado', ¿qué hago?" },
  { section: '🔐 Accesos y QR', question: 'Tengo un profe nuevo, ¿cómo habilito su QR?' },

  // 👥 Ocupación y beneficios
  { section: '👥 Ocupación y beneficios', question: 'La ocupación de la app no coincide con lo que veo en la sede' },
  { section: '👥 Ocupación y beneficios', question: '¿Cuántos check-ins necesita el usuario para el beneficio de mes gratis?' },

  // 💳 Tarjetas y app
  { section: '💳 Tarjetas y app', question: "No puedo registrar la tarjeta, dice 'servicio no disponible'" },
  { section: '💳 Tarjetas y app', question: 'La app pide actualizar pero ya está actualizada' },

  // ⚙️ Configuración
  { section: '⚙️  Configuración', question: 'Aparece una sala en la app que no existe, ¿cómo la saco?' },
  { section: '⚙️  Configuración', question: '¿Dónde defino el precio de un phonebooth?' },
  { section: '⚙️  Configuración', question: '¿Cómo cambio el horario de una sede?' },
  { section: '⚙️  Configuración', question: '¿Un usuario puede cambiar su reserva por otra clase?' },
  { section: '⚙️  Configuración', question: 'Programé un cierre y le llegaron mails a gente de un día que no cerré' },

  // 🖥 Admin panel
  { section: '🖥  Admin panel', question: '¿Qué diferencia hay entre modo Activa, Próxima a abrir y Marcha blanca?' },
  { section: '🖥  Admin panel', question: '¿Puedo cambiar una sede a Próxima a abrir después de publicarla?' },
  { section: '🖥  Admin panel', question: '¿Qué es una sede promocional? ¿Cuándo la uso?' },
  { section: '🖥  Admin panel', question: '¿Cuándo tengo que eliminar una sede promocional?' },
  { section: '🖥  Admin panel', question: 'Despubliqué una sede sin querer, ¿perdí los datos?' },
  { section: '🖥  Admin panel', question: '¿Por qué en Marcha blanca todo sale a $0?' },
  { section: '🖥  Admin panel', question: 'Los números de Métricas no coinciden con EVO' },
  { section: '🖥  Admin panel', question: '¿Puedo editar el precio dinámico desde el Admin?' }
];

const EXIT_WORDS = new Set(['exit', 'quit', 'salir', 'chau', 'bye']);
const MENU_WORDS = new Set(['menu', 'menú', 'help', 'ayuda', '?']);

function printMenu() {
  console.log('\n📋 Preguntas frecuentes:');
  console.log('   Escribí el número de una pregunta, o tirala en tus palabras.\n');

  let currentSection = '';
  PRESETS.forEach((p, i) => {
    if (p.section !== currentSection) {
      console.log(`\n  ${p.section}`);
      currentSection = p.section;
    }
    const num = String(i + 1).padStart(2);
    console.log(`  [${num}] ${p.question}`);
  });

  console.log('\n  💡 Comandos: "menu" para volver a esta lista · "exit" para salir\n');
}

async function runQuestion(question: string) {
  const start = Date.now();
  try {
    const result = await ask(question);
    const elapsed = Date.now() - start;
    const scoreStr = result.top_similarity !== null ? result.top_similarity.toFixed(3) : '(n/a)';

    console.log();
    if (result.needs_handoff) {
      console.log('🤔 No encontré esto en la documentación actual.');
      console.log(`   Motivo: ${result.reason}`);
      console.log('   → Derivación al equipo de Amalgama.');
    } else {
      console.log(`💬 ${result.answer}`);
      console.log();
      console.log(`   📎 Fuente: ${result.cited_faq_id ?? '(sin cita)'}`);
    }
    console.log(`   ⏱  ${elapsed}ms · top score: ${scoreStr}\n`);
  } catch (err) {
    console.log(`\n❌ Error: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// Main loop
const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log('\n🤖 NEO Support Bot — chat interactivo');
printMenu();

while (true) {
  let input: string;
  try {
    input = (await rl.question('❯ ')).trim();
  } catch {
    // Ctrl+C / Ctrl+D
    break;
  }

  if (!input) continue;
  if (EXIT_WORDS.has(input.toLowerCase())) break;
  if (MENU_WORDS.has(input.toLowerCase())) {
    printMenu();
    continue;
  }

  // ¿Es un número de preset?
  const num = Number(input);
  if (Number.isInteger(num) && num >= 1 && num <= PRESETS.length) {
    const preset = PRESETS[num - 1]!;
    console.log(`\n→ ${preset.question}`);
    await runQuestion(preset.question);
    continue;
  }

  // Modo libre — mandar tal cual
  await runQuestion(input);
}

console.log('\n👋 Chau.\n');
rl.close();
