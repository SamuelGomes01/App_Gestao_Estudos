'use strict';
// Variedade na largada do plano: nem o cronograma nem o ciclo devem abrir com uma
// família de matéria só (o caso clássico: edital jurídico começando com 3 Direitos
// e Português entrando no terceiro mês).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadDomain } = require('./helpers/load-domain');
const D = loadDomain();

function edital(arquivo) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', arquivo), 'utf8'));
}

function stateDoEdital(arquivo) {
  const ed = edital(arquivo);
  const base = { plano: null, disciplinas: [], config: {}, sessoes: [], revisoes: [], simulados: [], agenda: [], flashcards: [] };
  const imp = D.mesclarPlano(base, {
    versao: 1,
    plano: { concurso: ed.titulo, meta: { corte_pct: 70 }, ritmos: { ativo: 'sustentavel' } },
    gerado_em: null, disciplinas: ed.disciplinas, cronograma: {}
  });
  return Object.assign({}, base, { plano: imp.plano, disciplinas: imp.disciplinas });
}

function largadaDoCiclo(arquivo) {
  const blocos = D.sugerirCiclo(stateDoEdital(arquivo), { minutosSemana: 960, minBloco: 30, maxBloco: 60 });
  return blocos.filter((b) => (b.voltaInicio || 1) === 1).map((b) => b.disciplinaId);
}

test('grupoCognitivoDisciplina: reconhece a abreviação "Dir." usada nos editais', () => {
  assert.equal(D.grupoCognitivoDisciplina({ id: 'PPE', nome: 'Noções Dir. Processual Penal' }), 'direito');
  assert.equal(D.grupoCognitivoDisciplina({ id: 'DEF', nome: 'Noções Dir. Pessoas com Deficiência' }), 'direito');
  assert.equal(D.grupoCognitivoDisciplina({ id: 'LEG', nome: 'Legislação' }), 'direito');
  assert.equal(D.grupoCognitivoDisciplina({ id: 'POR', nome: 'Língua Portuguesa' }), 'linguagem');
  assert.equal(D.grupoCognitivoDisciplina({ id: 'RLM', nome: 'Raciocínio Lógico-Matemático' }), 'logica');
  assert.equal(D.grupoCognitivoDisciplina({ id: 'ARQ', nome: 'Arquivologia' }), 'geral');
});

test('promoverVariedadeLargada: largada só de Direito promove a matéria de linguagem', () => {
  const ordem = [
    { id: 'ADM', grupo: 'direito' }, { id: 'CON', grupo: 'direito' }, { id: 'PCI', grupo: 'direito' },
    { id: 'POR', grupo: 'linguagem' }, { id: 'RLM', grupo: 'logica' }
  ];
  const dados = () => ({ peso: 1, volume: 1 });
  assert.equal(D.promoverVariedadeLargada(ordem, ordem, dados).id, 'POR');
});

test('promoverVariedadeLargada: sem linguagem na largada, entra a matéria-BASE (não a complementar)', () => {
  // "Redação Oficial" costuma ganhar no score puro por ter poucos tópicos e, com
  // isso, a melhor prioridade MÉDIA — mas a matéria-base é Língua Portuguesa.
  const por = { id: 'POR', grupo: 'linguagem' };
  const red = { id: 'RED', grupo: 'linguagem' };
  const ordem = [
    { id: 'DAD', grupo: 'direito' }, { id: 'LEG', grupo: 'direito' }, { id: 'ADM', grupo: 'direito' },
    red, por
  ];
  const dados = (d) => (d === por ? { peso: 1, volume: 9 } : { peso: 1, volume: 2 });
  assert.equal(D.promoverVariedadeLargada(ordem, ordem, dados).id, 'POR');
});

test('promoverVariedadeLargada: largada já variada não promove ninguém', () => {
  const ordem = [
    { id: 'DAD', grupo: 'direito' }, { id: 'POR', grupo: 'linguagem' }, { id: 'LEG', grupo: 'direito' },
    { id: 'RLM', grupo: 'logica' }
  ];
  assert.equal(D.promoverVariedadeLargada(ordem, ordem, () => ({ peso: 1, volume: 1 })), null);
});

test('promoverVariedadeLargada: edital sem linguagem só quebra a monotonia da família', () => {
  const ordem = [
    { id: 'QUI', grupo: 'geral' }, { id: 'FIS', grupo: 'geral' }, { id: 'OPE', grupo: 'geral' },
    { id: 'MAT', grupo: 'logica' }
  ];
  assert.equal(D.promoverVariedadeLargada(ordem, ordem, () => ({ peso: 1, volume: 1 })).id, 'MAT');
});

test('promoverVariedadeLargada: plano pequeno (todas já começam juntas) não promove', () => {
  const ordem = [{ id: 'A', grupo: 'direito' }, { id: 'B', grupo: 'direito' }, { id: 'C', grupo: 'direito' }];
  assert.equal(D.promoverVariedadeLargada(ordem, ordem, () => ({ peso: 1, volume: 1 })), null);
});

test('ciclo do TRF3 não abre a volta 1 só com Direito', () => {
  const state = stateDoEdital('edital-trf3-tjaa-2024.json');
  const blocos = D.sugerirCiclo(state, { minutosSemana: 960, minBloco: 30, maxBloco: 60 });
  const largada = blocos.filter((b) => (b.voltaInicio || 1) === 1).map((b) => b.disciplinaId);
  assert.ok(largada.includes('POR'), 'Português deveria abrir o ciclo, veio: ' + largada.join(','));
  // classifica pelo NOME real da disciplina — o id sozinho não diz a família
  const grupos = new Set(largada.map(function (id) {
    return D.grupoCognitivoDisciplina(D.disciplinaPorId(state, id));
  }));
  assert.ok(grupos.size > 1, 'a volta 1 ficou com uma família de matéria só: ' + largada.join(','));
});

test('ciclo: toda disciplina do edital entra em alguma volta', () => {
  const state = stateDoEdital('edital-trf3-tjaa-2024.json');
  const blocos = D.sugerirCiclo(state, { minutosSemana: 960, minBloco: 30, maxBloco: 60 });
  const noCiclo = new Set(blocos.map((b) => b.disciplinaId));
  const esperadas = state.disciplinas.filter((d) => d.id !== 'ORF').map((d) => d.id);
  esperadas.forEach((id) => assert.ok(noCiclo.has(id), 'disciplina ' + id + ' ficou fora do ciclo'));
});
