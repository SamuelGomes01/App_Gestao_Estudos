'use strict';
// Cronômetro que sobrevive à exclusão do plano: o estado do timer mora numa
// chave própria do localStorage (estudos.timer), então apagar o plano deixava
// uma sessão "pausada" apontando para um tópico que não existe mais.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDomain } = require('./helpers/load-domain');
const { loadStore } = require('./helpers/load-store');
const D = loadDomain();
const Store = loadStore();

function disciplina(id) {
  return {
    id: id, nome: id, cor: '#2454D6',
    topicos: [{ id: id + '-U1', nome: 'Unidade 1', status: 'pendente' }]
  };
}

function estadoComDoisPlanos() {
  const state = Store.estadoVazio();
  state.planos = [
    { id: 'p1', plano: { concurso: 'Antigo' }, disciplinas: [disciplina('ADM')], cronogramas: {}, links: [] },
    { id: 'p2', plano: { concurso: 'Atual' }, disciplinas: [disciplina('POR')], cronogramas: {}, links: [] }
  ];
  Store.ativarPlano(state, 'p2');
  return state;
}

test('tópico de um plano INATIVO ainda conta como existente (não é órfão)', () => {
  const state = estadoComDoisPlanos();
  assert.equal(D.topicoPorId(state, 'ADM-U1'), null, 'não está no plano ativo');
  assert.equal(D.topicoExisteEmAlgumPlano(state, 'ADM-U1'), true);
  assert.equal(D.topicoExisteEmAlgumPlano(state, 'POR-U1'), true);
});

test('após excluir o plano, o tópico do cronômetro fica órfão', () => {
  const state = estadoComDoisPlanos();
  Store.removerPlano(state, 'p1');
  assert.equal(D.topicoExisteEmAlgumPlano(state, 'ADM-U1'), false);
  assert.equal(D.topicoExisteEmAlgumPlano(state, 'POR-U1'), true);
});

test('topicoExisteEmAlgumPlano é seguro com entradas incompletas', () => {
  const state = Store.estadoVazio();
  assert.equal(D.topicoExisteEmAlgumPlano(state, 'X-1'), false);
  assert.equal(D.topicoExisteEmAlgumPlano(state, ''), false);
  assert.equal(D.topicoExisteEmAlgumPlano(null, 'X-1'), false);
  state.planos = [{ id: 'p1' }, { id: 'p2', disciplinas: [{ id: 'D' }] }];
  assert.equal(D.topicoExisteEmAlgumPlano(state, 'X-1'), false);
});
