'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');

function recursosLocaisVersionadosDoHtml() {
  const encontrados = [];
  const regex = /(?:src|href)="((?:css|js|data)\/[^"]+\?v=[^"]+)"/g;
  let match;
  while ((match = regex.exec(indexHtml))) encontrados.push('./' + match[1]);
  return encontrados;
}

test('service worker pré-carrega as mesmas versões locais usadas pelo HTML', () => {
  const ausentes = recursosLocaisVersionadosDoHtml().filter(function (recurso) {
    return !serviceWorker.includes("'" + recurso + "'");
  });
  assert.deepEqual(ausentes, []);
});

test('arquivos críticos de sincronização são publicados na mesma versão da PWA', () => {
  const arquivos = ['css/styles.css', 'js/store.js', 'js/firebase-sync.js', 'js/app.js'];
  const versoes = arquivos.map(function (arquivo) {
    const match = indexHtml.match(new RegExp(arquivo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\?v=([^"\\s]+)'));
    assert.ok(match, arquivo + ' precisa ter versão explícita');
    return match[1];
  });
  assert.equal(new Set(versoes).size, 1, 'assets críticos não podem ficar em gerações diferentes');
  // O slug acompanha a feature de cada bump; o que o teste garante é o FORMATO
  // (estudos-v<n>-<slug>), não o nome de uma entrega específica — senão todo bump de
  // cache quebra este teste e obriga a editá-lo junto.
  assert.match(serviceWorker, /const CACHE = 'estudos-v\d+-[a-z0-9-]+'/);
});

test('service worker mantém disponíveis offline o plano de exemplo e os ícones do manifesto', () => {
  [
    './data/exemplo-trf3.json?v=20260718g-integridade-sync',
    './assets/carreiras/capa-inss-tecnico.png',
    './assets/carreiras/capa-trf-tjaa.jpg?v=20260721-real1',
    './assets/carreiras/capa-trt-tjaa.jpg?v=20260721-real1',
    './icons/icone.svg',
    './icons/icone-192.png',
    './icons/icone-512.png'
  ].forEach(function (recurso) {
    assert.ok(serviceWorker.includes("'" + recurso + "'"), recurso + ' não está no pré-cache');
  });
});
