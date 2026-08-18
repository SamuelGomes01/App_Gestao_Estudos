/* ============================================================
   app.js — roteamento por hash + renderização das telas
   Telas: #hoje #timer #revisoes #edital #simulados #stats
          #historico #ajustes #mais (atalhos no celular)
   ============================================================ */
(function () {
  'use strict';

  const D = window.Dominio;
  const TITULO_PADRAO = document.title;
  const ADMIN_EMAIL = 'casar70@gmail.com';
  const CHAVE_ULTIMO_USUARIO = 'estudos.firebase.ultimoUsuario';
  const INSTAGRAM_DIRECT_URL = 'https://ig.me/m/samuel_g.silva';
  const IA_FLASHCARDS_DISPONIVEL = false;
  let state = window.Store.carregar();
  // Varre planos-rascunho: criados ao clicar "Iniciar" mas nunca confirmados no
  // assistente (sessão fechada/recarregada sem passar pelo descarte). Evita o
  // "plano fantasma" sem nada preenchido no catálogo.
  function limparPlanosRascunho() {
    if (!state || !Array.isArray(state.planos)) return;
    const rascunhos = state.planos.filter(function (p) { return p && p.plano && p.plano.rascunho; });
    if (!rascunhos.length) return;
    rascunhos.forEach(function (p) {
      if (typeof limparDadosVinculados === 'function') limparDadosVinculados(p.id);
      window.Store.removerPlano(state, p.id);
    });
    window.Store.salvar(state, { marcarAlterado: false });
  }
  limparPlanosRascunho();
  // Migração: planos combinados criados ANTES de ocultoNoCatalogo deixaram o
  // edital-combinado visível na vitrine da aba Planos. Marca-os retroativamente
  // (o edital de origem de um plano `combinado` é um artefato do plano, não do
  // catálogo). Roda só uma vez — depois é no-op.
  function marcarCombinadosOcultos() {
    if (!state || !Array.isArray(state.planos) || !Array.isArray(state.editais)) return;
    let mudou = false;
    state.planos.forEach(function (p) {
      if (!p || !p.plano || !p.plano.combinado || !p.plano.origemEditalId) return;
      const ed = state.editais.find(function (e) { return e && e.id === p.plano.origemEditalId; });
      if (ed && !ed.ocultoNoCatalogo) { ed.ocultoNoCatalogo = true; mudou = true; }
    });
    if (mudou) window.Store.salvar(state, { marcarAlterado: false });
  }
  marcarCombinadosOcultos();
  // Modo exemplo: deixa visitantes sem login explorarem com um plano de demonstração.
  // Tudo fica só em memória — nada é persistido nem sincronizado.
  let modoDemo = false;
  let modoOfflineLocal = false;
  let catalogoGlobalEditais = normalizarCatalogoGlobal(window.CATALOGO_EDITAIS_GLOBAIS || []);
  const catalogoEditaisBase = (window.CATALOGO_EDITAIS_BASE || []).map(function (e) {
    return normalizarEditalCatalogo(e, 'base');
  });
  const catalogoCarreirasBase = normalizarCatalogoGlobal(window.CATALOGO_CARREIRAS || []);
  let timerPreselecao = null;     // tópico vindo de "Estudar" na fila
  const ID_SIM_TIMER = '__simulado__'; // "disciplina" sintética do timer p/ cronometrar um simulado
  let editalAbertas = new Set();  // disciplinas expandidas no edital
  let syncStatus = window.Sync ? window.Sync.status() : { estado: 'local', texto: 'Somente neste navegador' };
  let firebaseStatus = window.FirebaseSync ? window.FirebaseSync.status() : { estado: 'carregando', texto: 'Preparando Firebase', fonte: 'Firebase' };
  let autenticacaoExpirou = false; // rede de segurança: se o Firebase nunca responder, libera a tela de login
  let falhaPersistenciaAvisadaEm = 0;
  let pintarTimerAtual = null;
  let pintarTimerModal = null; // timer rápido em modal (pinta em qualquer rota)
  let timerBlocoPendente = null; // bloco da agenda a creditar no próximo timer iniciado
  let timerRevisaoPendente = null; // revisão a concluir ao encerrar o próximo timer iniciado
  let timerLimitePendente = null; // tempo restante do bloco, pré-preenchido no timer
  let timerAutoIniciar = false;  // ao abrir a tela do timer, já dispara a contagem
  let audioCtx = null;
  let ultimaRotaRender = null;
  let pulaRecalcSemanal = false; // evita recálculo/toast como efeito colateral (ex.: ao excluir um plano)
  let planejamentoConfigAberta = false;
  // Paleta "Personalize seu plano" recolhida por padrão no celular (economiza
  // espaço); no desktop o CSS a mostra sempre. Guarda a escolha na sessão.
  let paletaExpandida = false;
  let disciplinaDetalheId = null;
  let catalogoFiltro = { tipo: 'todos', busca: '', orgao: '', cargo: '', estado: '' };
  let comparacaoIds = []; // editais selecionados p/ comparar na aba Planos (máx. 2)
  let adminBusca = '';
  let adminPedidosGlobais = null;
  let googleCalendarToken = null;
  let catalogoGlobalTentado = false;
  // true quando a tentativa de carregar o catálogo global terminou (sucesso, falha
  // ou ausência de Firebase). Só então o fallback empacotado (data/) pode aparecer —
  // evita a "piscada" dos editais-exemplo sem foto enquanto o global ainda carrega.
  let catalogoGlobalCarregado = false;
  let catalogoGlobalPromise = null;
  let catalogoPublicacaoErro = '';
  let catalogoPublicacaoOkEm = '';
  let onboardingNomeAberto = false;
  let tourAtivo = false;   // tour guiado em andamento
  let tourPasso = 0;
  let tourEntrouNoDemo = false; // o tour é que ativou o demo (volta ao real ao fim)
  let syncInicialFeito = false; // 1ª sincronização com o Firebase concluída (evita pedir o nome antes do estado da nuvem chegar)
  let statsTopicosFiltro = { disciplina: '', ordem: 'piores', limite: '18' };

  // ---------------- utilidades de UI ----------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clonarJson(obj) {
    return JSON.parse(JSON.stringify(obj || {}));
  }

  function slugCatalogo(s) {
    return normalizarBusca(s || 'edital').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 54) || 'edital';
  }

  function normalizarEditalCatalogo(e, origem) {
    const c = clonarJson(e);
    if (window.Store && window.Store.normalizarAcentosEdital) window.Store.normalizarAcentosEdital(c);
    c.id = c.id || ((origem === 'global' ? 'global-' : 'edt-') + slugCatalogo(c.titulo));
    c.disciplinas = Array.isArray(c.disciplinas) ? c.disciplinas : [];
    c.arquivado = !!c.arquivado;
    // Editais empacotados em data/ vêm no formato "esquematizado" da skill
    // (nota_corte_sugerida_pct, janela_prova, escolaridade...). Quando faltam os
    // campos internos (notaCorte, janelaProva, cortes), converte aqui — assim o
    // card mostra corte/data/comparação corretos mesmo quando o app cai no
    // fallback de data/ (catálogo global vazio/indisponível).
    if (c.notaCorte == null || c.cortes == null || c.janelaProva == null) {
      const meta = metadadosEditalDeJson(e);
      if (c.notaCorte == null && meta.notaCorte != null) c.notaCorte = meta.notaCorte;
      if (c.cortes == null && meta.cortes) c.cortes = meta.cortes;
      if (!c.tipoCorte && meta.tipoCorte) c.tipoCorte = meta.tipoCorte;
      if (c.janelaProva == null && meta.janelaProva && (meta.janelaProva.inicio || meta.janelaProva.fim)) {
        c.janelaProva = meta.janelaProva;
      }
      if (c.emAlta == null) c.emAlta = !!meta.emAlta;
    }
    if (!c.foto) c.foto = c.fotoUrl || c.imagem || '';
    c._global = origem === 'global';
    c._base = origem === 'base';
    return c;
  }

  function normalizarCatalogoGlobal(lista) {
    if (!Array.isArray(lista)) return [];
    return lista.map(function (e) { return normalizarEditalCatalogo(e, 'global'); });
  }

  function carreirasPersonalizadas() {
    if (!state.config) state.config = {};
    if (!Array.isArray(state.config.carreirasPersonalizadas)) state.config.carreirasPersonalizadas = [];
    return state.config.carreirasPersonalizadas;
  }

  function ehItemCarreira(e) {
    return !!(e && e.tipoCatalogo === 'carreira');
  }

  function carreirasGlobais() {
    const mapa = new Map();
    (catalogoGlobalEditais || []).forEach(function (e) {
      if (ehItemCarreira(e)) mapa.set(e.id, e);
    });
    (state.editais || []).forEach(function (e) {
      if (ehItemCarreira(e)) mapa.set(e.id, e);
    });
    return Array.from(mapa.values());
  }

  function carreirasDoCatalogo() {
    const globais = carreirasGlobais();
    const pessoais = usuarioAdmin() ? [] : carreirasPersonalizadas();
    const idsGlobais = {};
    const idsPessoais = {};
    globais.forEach(function (e) { idsGlobais[e.id] = true; });
    pessoais.forEach(function (e) { idsPessoais[e.id] = true; });
    return D.mesclarCatalogoCarreiras(catalogoCarreirasBase, globais.concat(pessoais))
      .map(function (e) {
        const n = normalizarEditalCatalogo(e, 'carreira');
        n._carreiraGlobal = !!idsGlobais[n.id];
        n._carreiraPessoal = !!idsPessoais[n.id];
        n._personalizada = !!(idsGlobais[n.id] || idsPessoais[n.id]);
        return n;
      });
  }

  function carreiraBasePorId(id) {
    return catalogoCarreirasBase.find(function (e) { return e.id === id; }) || null;
  }

  function carreiraPorId(id) {
    return carreirasDoCatalogo().find(function (e) { return e.id === id; }) || null;
  }

  function editaisDoCatalogo() {
    const mapa = new Map();
    // 1) planos-base distribuídos com o produto. Continuam disponíveis offline e
    // podem ser sobrescritos por uma versão global ou personalizada com o mesmo id.
    catalogoEditaisBase.forEach(function (e) { mapa.set(e.id, e); });
    // 2) catálogo global do Firebase (tem as capas/imagens cadastradas pelo admin)
    catalogoGlobalEditais.forEach(function (e) {
      if (ehItemCarreira(e)) return;
      const n = normalizarEditalCatalogo(e, 'global');
      mapa.set(n.id, n);
    });
    // 3) editais do perfil do usuário.
    (state.editais || []).forEach(function (e) {
      if (!ehItemCarreira(e)) mapa.set(e.id, normalizarEditalCatalogo(e, 'perfil'));
    });
    // Planos-base de carreira fazem parte do produto e continuam disponíveis
    // offline. Entram por último para não serem apagados por uma publicação do
    // catálogo administrativo de concursos.
    carreirasDoCatalogo().forEach(function (e) { mapa.set(e.id, e); });
    return Array.from(mapa.values());
  }

  // Lista para o PAINEL DO ADMIN (Configurações): mostra só o catálogo real
  // (global do Firebase + editais do perfil), NUNCA os exemplos embutidos em
  // data/. Evita a "piscada" de editais-exemplo que aparecem e somem quando o
  // catálogo real chega, e impede botões de excluir em editais não gerenciáveis.
  function editaisDoCatalogoAdmin() {
    const mapa = new Map();
    catalogoEditaisBase.forEach(function (e) { mapa.set(e.id, e); });
    catalogoGlobalEditais.forEach(function (e) {
      if (ehItemCarreira(e)) return;
      const n = normalizarEditalCatalogo(e, 'global');
      mapa.set(n.id, n);
    });
    (state.editais || []).forEach(function (e) {
      if (!ehItemCarreira(e)) mapa.set(e.id, normalizarEditalCatalogo(e, 'perfil'));
    });
    return Array.from(mapa.values());
  }

  function editalPorId(id) {
    return editaisDoCatalogo().find(function (e) { return e.id === id; }) || null;
  }

  // Calculadora de remuneração específica do cargo, quando houver. Identifica
  // pelo texto do edital (título/órgão/cargo): Petrobras nível técnico e Técnico
  // Judiciário Federal (TRF/TRT/TRE/tribunais superiores) têm página própria.
  // Devolve { arquivo, rotulo } ou null.
  function calculadoraDoEdital(e) {
    if (!e) return null;
    const txt = ((e.titulo || '') + ' ' + (e.orgao || '') + ' ' + (e.cargo || '')).toLowerCase();
    // Petrobras e Transpetro: mesma carreira/ACT do Sistema Petrobras, então
    // compartilham a calculadora.
    if (/petrobras|transpetro|petróleo brasileiro/.test(txt)) {
      return { arquivo: 'calc/petrobras.html', rotulo: '💰 Quanto ganha um técnico da Petrobras' };
    }
    // Técnico Judiciário FEDERAL: precisa ser "técnico judiciário" E de um órgão
    // da Justiça da União (TRF/TRT/TRE/tribunais superiores). Exclui os Tribunais
    // de Justiça estaduais (ex.: TJSP — Escrevente Técnico Judiciário).
    const ehTecJud = /t[ée]cnico\s+judici[áa]rio/.test(txt);
    const ehFederal = /\b(trf|trt|tre|tst|tse|stj|stf|cjf|tjdft|stm)\b|tribunal regional|tribunal superior|justi[çc]a (federal|do trabalho|eleitoral|militar)/.test(txt);
    if (ehTecJud && ehFederal) {
      return { arquivo: 'calc/judiciario-federal.html', rotulo: '💰 Quanto ganha um técnico judiciário federal' };
    }
    // Carreira TAE (técnico-administrativo em educação) — institutos federais,
    // universidades federais, CEFET, Colégio Pedro II. Marcador forte: PCCTAE.
    // Calculadora externa (site de terceiros), abre em nova aba.
    if (/\bpcctae\b|t[ée]cnico[- ]administrativos? em educa[çc]|edital tae|assistente em administra[çc]/.test(txt)) {
      return { url: 'https://taes.com.br/', externo: true, rotulo: '💰 Calculadora de salário (carreira TAE)' };
    }
    // Escrevente Técnico Judiciário do TJSP (estadual) — calculadora externa.
    if (/\btjsp\b|tribunal de justi[çc]a do estado de s[ãa]o paulo/.test(txt) && /escrevente/.test(txt)) {
      return { url: 'https://lcavalini.github.io/remuneracao-tjsp/', externo: true, rotulo: '💰 Calculadora de salário (Escrevente TJSP)' };
    }
    return null;
  }

  // Abre a calculadora de remuneração num modal amplo, isolada num iframe (cada
  // calculadora é uma página HTML completa com estilos próprios).
  function abrirCalculadoraRemuneracao(calc) {
    if (!calc) return;
    // Calculadoras externas (sites de terceiros) abrem em nova aba — sempre a
    // versão oficial do autor, sem embutir o conteúdo no app.
    if (calc.externo) { window.open(calc.url, '_blank', 'noopener'); return; }
    const titulo = calc.rotulo.replace(/^💰\s*/, '');
    // Calculadora própria: tela cheia (sem scroll aninhado de modal). Barra no
    // topo com Fechar sempre visível + Fechar no final, e a página rola dentro
    // do iframe.
    const ov = document.createElement('div');
    ov.className = 'calc-fullscreen';
    // Sem barra de título no topo: o nome já aparece dentro da própria
    // calculadora. O botão de fechar fica no rodapé, fixo na base da tela.
    ov.innerHTML =
      '<iframe class="calc-fs-frame" src="' + esc(calc.arquivo) + '" title="' + esc(titulo) + '"></iframe>' +
      '<div class="calc-fs-rodape"><button type="button" class="botao calc-fs-fechar">Fechar calculadora</button></div>';
    document.body.appendChild(ov);
    const scrollAntes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function fechar() {
      ov.remove();
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = scrollAntes;
    }
    function onKey(e) { if (e.key === 'Escape') fechar(); }
    document.addEventListener('keydown', onKey);
    ov.querySelectorAll('.calc-fs-fechar').forEach(function (b) { b.addEventListener('click', fechar); });
  }

  function limparEditalParaCatalogo(e) {
    const c = clonarJson(e);
    delete c._global;
    return c;
  }

  // Plano combinado é artefato do plano do aluno, NÃO um edital do catálogo. Detecta
  // tanto os marcados (ocultoNoCatalogo) quanto os já publicados antes da flag (pelo
  // título "… (combinado)"). Usado para nunca publicar nem listar combinados.
  function ehEditalCombinado(e) {
    return !!(e && (e.ocultoNoCatalogo || /\(combinado\)\s*$/i.test(e.titulo || '')));
  }

  function carregarCatalogoGlobalFirebase() {
    if (catalogoGlobalPromise) return catalogoGlobalPromise;
    if (catalogoGlobalTentado) return Promise.resolve(catalogoGlobalEditais);
    if (!window.FirebaseSync || !window.FirebaseSync.carregarCatalogoGlobal) {
      // sem fonte remota: o fallback empacotado é legítimo, libera-o
      catalogoGlobalCarregado = true;
      return Promise.resolve(catalogoGlobalEditais);
    }
    catalogoGlobalTentado = true;
    catalogoGlobalPromise = window.FirebaseSync.carregarCatalogoGlobal().then(function (lista) {
      catalogoGlobalEditais = normalizarCatalogoGlobal(lista || []);
      catalogoGlobalCarregado = true;
      render();
      return catalogoGlobalEditais;
    }).catch(function (e) {
      console.warn('Não consegui carregar catálogo global.', e);
      catalogoGlobalCarregado = true;
      render();
      return catalogoGlobalEditais;
    }).finally(function () {
      catalogoGlobalPromise = null;
    });
    return catalogoGlobalPromise;
  }

  function publicarCatalogoAdmin(opcoes) {
    opcoes = opcoes || {};
    if (!usuarioAdmin() || !window.FirebaseSync || !window.FirebaseSync.publicarCatalogoGlobal) return Promise.resolve();
    // Publica a UNIÃO do catálogo global atual com os editais do perfil (por id),
    // com o perfil tendo prioridade. Sem isso, salvar/editar UM edital republicava
    // só o state.editais e APAGAVA os demais que existiam apenas no catálogo global.
    // opcoes.removerId permite excluir um edital específico da publicação.
    const porId = new Map();
    // Nunca publica planos combinados (nem os já publicados antes da flag: a
    // próxima publicação do admin os remove do catálogo global de todos).
    (catalogoGlobalEditais || []).forEach(function (e) { if (!e.arquivado && !ehEditalCombinado(e)) porId.set(e.id, limparEditalParaCatalogo(e)); });
    (state.editais || []).forEach(function (e) { if (!e.arquivado && !ehEditalCombinado(e)) porId.set(e.id, limparEditalParaCatalogo(e)); });
    if (opcoes.removerId) porId.delete(opcoes.removerId);
    const editais = Array.from(porId.values());
    // PROTEÇÃO CRÍTICA: nunca sobrescrever o catálogo global com uma lista vazia.
    // Era isso que zerava o catálogo de todos — no login/modo exemplo o state era
    // resetado para vazio e um publish automático gravava editais:[] por cima.
    // Só permite publicar vazio quando explicitamente pedido (opcoes.permitirVazio),
    // que é o caso de o admin excluir o último edital de propósito.
    if (editais.length === 0 && !opcoes.permitirVazio) {
      if (opcoes.toast) toast('Nenhum edital para publicar — catálogo global mantido como está.', 'erro');
      return Promise.resolve();
    }
    return window.FirebaseSync.publicarCatalogoGlobal(editais).then(function () {
      catalogoGlobalEditais = normalizarCatalogoGlobal(editais);
      catalogoGlobalTentado = false;
      catalogoPublicacaoErro = '';
      catalogoPublicacaoOkEm = new Date().toISOString();
      if (opcoes.toast) toast('Catálogo global publicado para todos os usuários.', 'sucesso');
    }).catch(function (e) {
      console.warn('Não consegui publicar catálogo global.', e);
      catalogoPublicacaoOkEm = '';
      catalogoPublicacaoErro = 'Não consegui publicar o catálogo global. Atualize as regras do Firestore para liberar public/catalogo ao admin.';
      if (opcoes.toast) toast(catalogoPublicacaoErro, 'erro');
      render();
    });
  }

  function carregarCatalogoGlobalFirebaseAntigo() {
    if (!window.FirebaseSync || !window.FirebaseSync.carregarCatalogoGlobal) return Promise.resolve([]);
    return window.FirebaseSync.carregarCatalogoGlobal().then(function (lista) {
      catalogoGlobalEditais = normalizarCatalogoGlobal(lista || []);
      render();
      return catalogoGlobalEditais;
    }).catch(function (e) {
      console.warn('Não consegui carregar catálogo global.', e);
      return catalogoGlobalEditais;
    });
  }

  function publicarCatalogoAdminAntigo() {
    if (!usuarioAdmin() || !window.FirebaseSync || !window.FirebaseSync.publicarCatalogoGlobal) return Promise.resolve();
    const editais = (state.editais || []).filter(function (e) { return !e.arquivado && !ehEditalCombinado(e); }).map(limparEditalParaCatalogo);
    return window.FirebaseSync.publicarCatalogoGlobal(editais).then(function () {
      catalogoGlobalEditais = normalizarCatalogoGlobal(editais);
    }).catch(function (e) {
      console.warn('Não consegui publicar catálogo global.', e);
      toast('Não consegui publicar o catálogo global no Firebase.', 'erro');
    });
  }

  function salvar(opcoes) {
    opcoes = opcoes || {};
    if (modoDemo) return true; // modo exemplo: nada é gravado nem sincronizado
    const resultado = window.Store.salvar(state, opcoes);
    if (window.Sync && opcoes.sincronizar !== false) window.Sync.agendarEnvio(state);
    if (window.FirebaseSync && opcoes.sincronizar !== false) window.FirebaseSync.agendarEnvio(state);
    if (resultado && resultado.ok === false) {
      const agora = Date.now();
      if (agora - falhaPersistenciaAvisadaEm > 10000) {
        falhaPersistenciaAvisadaEm = agora;
        toast('O armazenamento local está cheio. Os dados seguem em memória; exporte um backup agora.', 'erro');
      }
      return false;
    }
    return true;
  }

  function statusSincronizacao() {
    if (firebaseStatus && firebaseStatus.estado !== 'carregando') return firebaseStatus;
    return syncStatus;
  }

  function usuarioAtual() {
    const atual = statusSincronizacao();
    if (atual && atual.usuario) return atual.usuario;
    if (modoOfflineLocal) {
      return {
        uid: localStorage.getItem(CHAVE_ULTIMO_USUARIO) || 'local',
        nome: 'Modo offline',
        email: 'dados locais',
        offline: true
      };
    }
    return null;
  }

  function usuarioLogado() {
    return !!usuarioAtual();
  }

  // Enquanto o Firebase ainda nao confirmou se existe sessao salva, mostramos um
  // splash neutro em vez da tela de login — assim quem ja esta logado entra direto,
  // sem o login "piscar". A flag autenticacaoExpirou garante que nunca travamos aqui.
  function autenticacaoPendente() {
    if (usuarioLogado() || autenticacaoExpirou) return false;
    const e = firebaseStatus && firebaseStatus.estado;
    return e === 'autenticando' || e === 'carregando';
  }

  function telaCarregandoAuth() {
    return '<section class="login-shell auth-splash">' +
      '<div class="auth-splash-card">' +
      '<div class="login-marca"><span class="marca-bolha" aria-hidden="true"></span><span>Gabaritei OS</span></div>' +
      '<div class="auth-splash-spinner" role="status" aria-label="Carregando"></div>' +
      '<p class="auth-splash-texto">Verificando sua sessão…</p>' +
      '</div>' +
      '</section>';
  }

  function usuarioAdmin() {
    const u = usuarioAtual();
    return !!(u && String(u.email || '').toLowerCase() === ADMIN_EMAIL);
  }

  function prepararEstadoParaUsuario(u) {
    if (!u || !u.uid) return;
    const ultimo = localStorage.getItem(CHAVE_ULTIMO_USUARIO);
    if (ultimo && ultimo !== u.uid) {
      state = window.Store.estadoVazio();
      window.Store.salvar(state, { marcarAlterado: false });
    }
    localStorage.setItem(CHAVE_ULTIMO_USUARIO, u.uid);
  }

  function toast(msg, tipo) {
    const raiz = document.getElementById('toast-raiz');
    const el = document.createElement('div');
    el.className = 'toast' + (tipo ? ' toast-' + tipo : '');
    el.textContent = msg;
    raiz.appendChild(el);
    setTimeout(function () { el.remove(); }, 3200);
  }

  function copiarTextoParaTransferencia(texto) {
    function copiarLegado() {
      try {
        const focoAnterior = document.activeElement;
        const aux = document.createElement('textarea');
        aux.value = texto;
        aux.setAttribute('readonly', '');
        aux.style.position = 'fixed';
        aux.style.opacity = '0';
        document.body.appendChild(aux);
        aux.select();
        const copiou = document.execCommand('copy');
        aux.remove();
        if (focoAnterior && focoAnterior.focus) focoAnterior.focus();
        return copiou;
      } catch (_) {
        return false;
      }
    }
    const copiaLegadaOk = copiarLegado();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto).then(function () {
        return true;
      }).catch(function () {
        return copiaLegadaOk;
      });
    }
    return Promise.resolve(copiaLegadaOk);
  }

  function abrirPedidoPronto(textoPedido) {
    const mensagem = 'Olá! Gostaria de pedir este edital no Gabaritei OS:\n\n' + textoPedido;
    const m = abrirModal(
      '<h3>Pedido pronto</h3>' +
      '<p class="sub">O Instagram não permite preencher essa mensagem automaticamente. Copie o texto abaixo, abra o Direct e cole na conversa.</p>' +
      '<label for="pedido-mensagem-pronta">Mensagem para enviar</label>' +
      '<textarea id="pedido-mensagem-pronta" class="pedido-mensagem-pronta" readonly></textarea>' +
      '<p class="pedido-copia-status" id="pedido-copia-status" aria-live="polite"></p>' +
      '<div class="modal-acoes">' +
      '<button type="button" class="botao-quieto" id="pedido-pronto-fechar">Fechar</button>' +
      '<button type="button" class="botao-secundario" id="pedido-copiar">Copiar mensagem</button>' +
      '<a class="botao botao-instagram" id="pedido-abrir-direct" href="' + INSTAGRAM_DIRECT_URL + '" target="_blank" rel="noopener noreferrer">' +
      '<svg aria-hidden="true"><use href="#ic-instagram"/></svg>Abrir Direct</a>' +
      '</div>'
    );
    const campoMensagem = m.querySelector('#pedido-mensagem-pronta');
    const statusCopia = m.querySelector('#pedido-copia-status');
    const botaoCopiar = m.querySelector('#pedido-copiar');
    campoMensagem.value = mensagem;

    function copiarMensagem() {
      botaoCopiar.disabled = true;
      return copiarTextoParaTransferencia(mensagem).then(function (copiou) {
        statusCopia.classList.toggle('copia-falhou', !copiou);
        statusCopia.textContent = copiou
          ? 'Mensagem copiada. Agora abra o Direct e cole para enviar.'
          : 'Não consegui copiar automaticamente. Selecione o texto acima e copie.';
        botaoCopiar.textContent = copiou ? 'Copiar novamente' : 'Tentar copiar';
        return copiou;
      }).finally(function () {
        botaoCopiar.disabled = false;
      });
    }

    m.querySelector('#pedido-pronto-fechar').addEventListener('click', fecharModal);
    botaoCopiar.addEventListener('click', copiarMensagem);
    m.querySelector('#pedido-abrir-direct').addEventListener('click', function () {
      copiarTextoParaTransferencia(mensagem);
    });
    copiarMensagem();
  }

  function abrirPedidoEdital(filtro) {
    filtro = filtro || {};
    const sugestao = [
      filtro.orgao ? 'Órgão: ' + filtro.orgao : '',
      filtro.cargo ? 'Cargo: ' + filtro.cargo : '',
      filtro.estado ? 'Estado: ' + filtro.estado : '',
      filtro.busca ? 'Observação: ' + filtro.busca : ''
    ].filter(Boolean).join('\n');
    const m = abrirModal('<h3>Pedir um edital</h3>' +
      '<p class="sub">Descreva o concurso/cargo que você quer ver no catálogo. O pedido será registrado no painel e prepararemos a mensagem para o Instagram.</p>' +
      '<label for="pedido-edital-txt">Edital desejado</label>' +
      '<textarea id="pedido-edital-txt" maxlength="500" placeholder="Ex.: TJSP Escrevente 2026, banca Vunesp, SP">' + esc(sugestao) + '</textarea>' +
      '<p class="sub pedido-instagram-nota"><svg aria-hidden="true"><use href="#ic-instagram"/></svg><span>Na próxima etapa, copie a mensagem pronta e abra o Direct.</span></p>' +
      '<div class="modal-acoes"><button class="botao-quieto" id="pedido-cancelar">Cancelar</button>' +
      '<button type="button" class="botao botao-instagram" id="pedido-enviar">' +
      '<svg aria-hidden="true"><use href="#ic-instagram"/></svg>Preparar pedido</button></div>');
    const campo = m.querySelector('#pedido-edital-txt');
    const enviar = m.querySelector('#pedido-enviar');
    m.querySelector('#pedido-cancelar').addEventListener('click', fecharModal);
    enviar.addEventListener('click', function () {
      const txt = (campo.value || '').trim();
      if (!txt) {
        toast('Descreva o edital que você quer pedir.', 'erro');
        campo.focus();
        return;
      }
      if (txt.length > 500) {
        toast('O pedido deve ter no máximo 500 caracteres.', 'erro');
        return;
      }
      if (window.FirebaseSync && window.FirebaseSync.enviarPedidoEdital) {
        window.FirebaseSync.enviarPedidoEdital({ texto: txt }).catch(function () {
          toast('Não consegui registrar no painel, mas você ainda pode enviar pelo Direct.', 'erro');
        });
      }
      abrirPedidoPronto(txt);
    });
  }

  function telaLogin() {
    const st = statusSincronizacao();
    const carregando = !window.FirebaseSync || (st && st.estado === 'carregando');
    const entrando = st && (st.estado === 'entrando' || st.estado === 'sincronizando');
    const texto = carregando ? 'Preparando acesso seguro...' : (entrando ? 'Conectando sua conta...' : 'Entrar com Google');
    const constanciaPreview = [0, 7, 8, 14, 15, 16, 22, 23, 29, 30, 31, 36, 37, 38, 39];
    return '<section class="login-shell">' +
      '<div class="login-card">' +
      '<div class="login-marca"><span class="marca-bolha" aria-hidden="true"></span><span>Gabaritei OS</span></div>' +
      '<h1>Seu plano de aprovação, no piloto automático</h1>' +
      '<p>O Gabaritei OS transforma o edital verticalizado em um plano de estudos semanal que se recalcula sozinho conforme você avança — prioriza o que mais cai, equilibra teoria e questões e ajusta as revisões ao seu desempenho até o dia da prova.</p>' +
      '<ul class="login-features">' +
      '<li><span aria-hidden="true">📌</span> Editais verticalizados com os tópicos que mais caem (regra 80/20)</li>' +
      '<li><span aria-hidden="true">📅</span> Plano semanal gerado do edital que se recalcula sozinho no seu ritmo</li>' +
      '<li><span aria-hidden="true">🔁</span> Revisões espaçadas que se adaptam ao seu desempenho e à incidência do tópico</li>' +
      '<li><span aria-hidden="true">🎯</span> Fila do dia inteligente: estuda primeiro o que mais rende pontos</li>' +
      '<li><span aria-hidden="true">⚖️</span> Comparação de editais para conciliar concursos sem perder tempo</li>' +
      '<li><span aria-hidden="true">🃏</span> Flashcards inteligentes — geração com IA em breve</li>' +
      '</ul>' +
      '<button id="login-google" class="login-botao" type="button"' + (carregando || entrando ? ' disabled' : '') + '>' + texto + '</button>' +
      '<button id="login-demo" class="login-demo" type="button">Explorar com um plano de exemplo</button>' +
      '<p class="login-nota">Comece em segundos com sua conta Google. Seu progresso fica salvo e separado por conta.</p>' +
      '</div>' +
      '<div class="login-preview" aria-hidden="true">' +
      '<div class="login-preview-top"></div>' +
      '<div class="login-preview-line login-preview-line-1"></div>' +
      '<div class="login-preview-line login-preview-line-2"></div>' +
      '<div class="login-preview-grid">' + Array.from({ length: 42 }).map(function (_, i) {
        return '<span class="' + (constanciaPreview.indexOf(i) >= 0 ? 'ativo' : '') + '"></span>';
      }).join('') + '</div>' +
      '</div>' +
      '</section>';
  }

  function ligarLogin(raiz) {
    const btn = raiz.querySelector('#login-google');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (!window.FirebaseSync) { toast('Login ainda está carregando. Tente de novo em alguns segundos.', 'erro'); return; }
      btn.disabled = true;
      window.FirebaseSync.login().catch(function () {
        toast('Não consegui abrir o login do Google. Confira o Firebase Auth.', 'erro');
      }).finally(function () {
        btn.disabled = false;
      });
    });
    const demo = raiz.querySelector('#login-demo');
    if (demo) demo.addEventListener('click', function () { entrarModoDemo(demo, { ofertarTour: true }); });
  }

  // Hook opcional chamado quando o modal principal fecha (por qualquer caminho:
  // botão, clique fora, hashchange). Usado para descartar plano-fantasma do wizard.
  let aoFecharModal = null;

  function abrirModal(html) {
    aoFecharModal = null; // limpa hook de um modal anterior
    const raiz = document.getElementById('modal-raiz');
    abrirModal.focoAnterior = document.activeElement;
    raiz.innerHTML = '<div class="modal-fundo"><div class="modal" role="dialog" aria-modal="true">' + html + '</div></div>';
    const modal = raiz.querySelector('.modal');
    const titulo = modal.querySelector('h1, h2, h3');
    if (titulo) {
      titulo.id = titulo.id || 'modal-titulo-' + Date.now().toString(36);
      modal.setAttribute('aria-labelledby', titulo.id);
    } else {
      modal.setAttribute('aria-label', 'Janela de diálogo');
    }
    raiz.querySelector('.modal-fundo').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) fecharModal();
    });
    raiz.onkeydown = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); fecharModal(); return; }
      if (e.key !== 'Tab') return;
      const focaveis = Array.from(modal.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
        .filter(function (el) { return el.offsetParent !== null; });
      if (!focaveis.length) { e.preventDefault(); modal.focus(); return; }
      const primeiro = focaveis[0], ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    modal.setAttribute('tabindex', '-1');
    setTimeout(function () {
      const primeiro = modal.querySelector('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),a[href]');
      (primeiro || modal).focus();
    }, 0);
    return modal;
  }

  function fecharModal() {
    pintarTimerModal = null;
    const hook = aoFecharModal; aoFecharModal = null;
    const raiz = document.getElementById('modal-raiz');
    raiz.onkeydown = null;
    raiz.innerHTML = '';
    const anterior = abrirModal.focoAnterior;
    abrirModal.focoAnterior = null;
    if (anterior && document.contains(anterior) && anterior.focus) anterior.focus();
    if (hook) hook();
  }

  // Diálogos amigáveis no lugar de window.confirm / window.prompt.
  // Empilham num overlay próprio (document.body), sem sobrescrever modais já abertos.
  function confirmar(opcoes) {
    opcoes = typeof opcoes === 'string' ? { mensagem: opcoes } : (opcoes || {});
    return new Promise(function (resolve) {
      const fundo = document.createElement('div');
      fundo.className = 'modal-fundo modal-fundo-dialogo';
      fundo.innerHTML = '<div class="modal modal-dialogo" role="alertdialog" aria-modal="true">' +
        (opcoes.icone ? '<div class="dialogo-icone" aria-hidden="true">' + esc(opcoes.icone) + '</div>' : '') +
        '<h3>' + esc(opcoes.titulo || 'Confirmar') + '</h3>' +
        (opcoes.mensagem ? '<p class="sub dialogo-msg">' + esc(opcoes.mensagem) + '</p>' : '') +
        '<div class="modal-acoes">' +
        '<button type="button" class="botao-quieto" data-cf="cancelar">' + esc(opcoes.cancelar || 'Cancelar') + '</button>' +
        '<button type="button"' + (opcoes.perigo ? ' class="botao-perigo"' : '') + ' data-cf="ok">' + esc(opcoes.confirmar || 'Confirmar') + '</button>' +
        '</div></div>';
      document.body.appendChild(fundo);
      function fechar(v) { document.removeEventListener('keydown', aoTecla); fundo.remove(); resolve(v); }
      function aoTecla(e) { if (e.key === 'Escape') fechar(false); }
      fundo.addEventListener('click', function (e) { if (e.target === fundo) fechar(false); });
      fundo.querySelector('[data-cf="cancelar"]').addEventListener('click', function () { fechar(false); });
      fundo.querySelector('[data-cf="ok"]').addEventListener('click', function () { fechar(true); });
      document.addEventListener('keydown', aoTecla);
      const ok = fundo.querySelector('[data-cf="ok"]');
      setTimeout(function () { ok.focus(); }, 20);
    });
  }

  function pedirTexto(opcoes) {
    opcoes = opcoes || {};
    return new Promise(function (resolve) {
      const fundo = document.createElement('div');
      fundo.className = 'modal-fundo modal-fundo-dialogo';
      const campoTexto = opcoes.multilinha
        ? '<textarea data-cf-input rows="3" maxlength="' + (parseInt(opcoes.maxlength, 10) || 80) + '" placeholder="' + esc(opcoes.placeholder || '') + '">' + esc(opcoes.valor || '') + '</textarea>'
        : '<input type="text" data-cf-input maxlength="' + (parseInt(opcoes.maxlength, 10) || 80) + '" placeholder="' + esc(opcoes.placeholder || '') + '" value="' + esc(opcoes.valor || '') + '">';
      fundo.innerHTML = '<div class="modal modal-dialogo" role="dialog" aria-modal="true">' +
        '<h3>' + esc(opcoes.titulo || 'Informe') + '</h3>' +
        (opcoes.mensagem ? '<p class="sub dialogo-msg">' + esc(opcoes.mensagem) + '</p>' : '') +
        '<form data-cf-form>' +
        campoTexto +
        '<div class="modal-acoes"><button type="button" class="botao-quieto" data-cf="cancelar">Cancelar</button>' +
        '<button type="submit">' + esc(opcoes.confirmar || 'Salvar') + '</button></div></form></div>';
      document.body.appendChild(fundo);
      const input = fundo.querySelector('[data-cf-input]');
      function fechar(v) { document.removeEventListener('keydown', aoTecla); fundo.remove(); resolve(v); }
      function aoTecla(e) { if (e.key === 'Escape') fechar(null); }
      fundo.addEventListener('click', function (e) { if (e.target === fundo) fechar(null); });
      fundo.querySelector('[data-cf="cancelar"]').addEventListener('click', function () { fechar(null); });
      fundo.querySelector('[data-cf-form]').addEventListener('submit', function (e) {
        e.preventDefault();
        fechar(input.value.trim() || null);
      });
      document.addEventListener('keydown', aoTecla);
      setTimeout(function () { input.focus(); input.select(); }, 20);
    });
  }

  function abrirOnboardingNome() {
    if (!usuarioLogado() || !state.config || state.config.onboardingNomeVisto || onboardingNomeAberto) return;
    // Espera a 1ª sincronização: senão pergunta o nome com base no estado LOCAL
    // (pré-nuvem) e repete o pedido a cada login, mesmo já tendo respondido antes.
    if (window.FirebaseSync && !syncInicialFeito && !autenticacaoExpirou) return;
    if (document.getElementById('modal-raiz').children.length) return;
    onboardingNomeAberto = true;
    const sugerido = state.config.nomeUsuario || nomeUsuario();
    const m = abrirModal(
      '<div class="boas-vindas-modal">' +
      '<div class="dialogo-icone" aria-hidden="true">👋</div>' +
      '<h3>Bem-vindo ao Gabaritei OS</h3>' +
      '<p class="sub dialogo-msg">Antes de começar: como você quer ser chamado na aba Hoje?</p>' +
      '<form id="bv-form">' +
      '<label for="bv-nome">Nome de saudação</label>' +
      '<input id="bv-nome" type="text" maxlength="40" autocomplete="given-name" placeholder="Ex.: Ana" value="' + esc(sugerido || '') + '">' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="bv-pular">Pular</button>' +
      '<button type="submit">Continuar</button></div>' +
      '</form></div>'
    );
    m.classList.add('modal-dialogo', 'modal-boas-vindas');
    aoFecharModal = function () {
      onboardingNomeAberto = false;
      if (!state.config.onboardingNomeVisto) {
        state.config.onboardingNomeVisto = true;
        salvar();
      }
    };
    function finalizar(nome) {
      if (nome) state.config.nomeUsuario = nome;
      state.config.onboardingNomeVisto = true;
      onboardingNomeAberto = false;
      salvar();
      fecharModal();
      // Primeiro acesso e ainda sem plano: leva o usuário direto ao catálogo de
      // editais, onde o guia de boas-vindas explica como escolher (ou montar) um plano.
      const semPlano = !state.plano;
      if (semPlano && location.hash !== '#planos') {
        location.hash = '#planos';
      }
      render();
      if (nome) toast('Saudação atualizada', 'sucesso');
    }
    m.querySelector('#bv-pular').addEventListener('click', function () { finalizar(''); });
    m.querySelector('#bv-form').addEventListener('submit', function (e) {
      e.preventDefault();
      finalizar(m.querySelector('#bv-nome').value.trim());
    });
    setTimeout(function () {
      const input = m.querySelector('#bv-nome');
      input.focus();
      input.select();
    }, 20);
  }

  // ---------------- tema claro/escuro ----------------
  function aplicarTema() {
    const tema = state.config && state.config.tema === 'escuro' ? 'escuro' : 'claro';
    document.documentElement.dataset.tema = tema;
    const metaCor = document.getElementById('meta-theme-color');
    if (metaCor) metaCor.setAttribute('content', tema === 'escuro' ? '#111319' : '#EDF1F8');
  }

  function alternarTema() {
    state.config.tema = state.config.tema === 'escuro' ? 'claro' : 'escuro';
    salvar();
    aplicarTema();
    render(); // recolore os gráficos (lêem as cores do tema ao serem criados)
    toast(state.config.tema === 'escuro' ? 'Modo escuro ativado 🌙' : 'Modo claro ativado ☀️');
  }

  function prepararAudio() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!audioCtx) audioCtx = new AudioContext();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {}
  }

  function tocarAlarme(duracaoS) {
    prepararAudio();
    if (navigator.vibrate) navigator.vibrate([180, 80, 180, 80, 180]);
    if (!audioCtx) return;
    const agora = audioCtx.currentTime;
    const total = duracaoS && duracaoS > 0 ? duracaoS : 0.9;
    const passo = 0.5;                                   // um bipe a cada 0,5s
    const n = Math.max(3, Math.round(total / passo));
    for (let i = 0; i < n; i++) {
      const osc = audioCtx.createOscillator();
      const ganho = audioCtx.createGain();
      const t = agora + i * passo;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(i % 2 ? 660 : 880, t);  // dois tons alternados
      ganho.gain.setValueAtTime(0.001, t);
      ganho.gain.exponentialRampToValueAtTime(0.18, t + 0.03);
      ganho.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(ganho).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.33);
    }
  }

  // Pede permissão de notificação ao iniciar qualquer cronômetro — é o que
  // permite o contador aparecer na bandeja quando o app vai para segundo plano.
  function pedirPermissaoNotificacao() {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    // Esta permissão serve somente ao cronômetro em segundo plano. Lembretes
    // diários exigem uma escolha separada e explícita no Perfil.
    Notification.requestPermission().catch(function () {});
  }

  // ---- Notificação "em andamento" do cronômetro (contador em segundo plano) ----
  const TAG_NOTIF_TIMER = 'estudos-timer';
  let ultimaNotifTimerMs = 0;
  let notifTimerAtiva = false;

  function minutosEstudoTimer(e) {
    if (!e) return 0;
    return Math.max(0, Number.isFinite(e.estudoMin) ? e.estudoMin : (e.decorridoMin || 0));
  }

  function textoNotifTimer(e) {
    if (e.modo === 'pomodoro') {
      return (e.pomoFase === 'foco' ? '🎯 Foco' : '☕ Pausa') + ' · ' + window.Timer.formatar(e.pomoRestanteMs) + ' restantes';
    }
    if (e.limiteMin) {
      return e.limiteRestanteMs > 0
        ? '⏱️ ' + window.Timer.formatar(e.limiteRestanteMs) + ' restantes'
        : '🎉 +' + window.Timer.formatar(e.decorridoMs - e.limiteMs) + ' além do planejado';
    }
    return '⏱️ ' + window.Timer.formatar(e.decorridoMs) + ' estudando';
  }

  function mostrarNotificacaoTimer(e, forcar) {
    if (!e || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (!navigator.serviceWorker || !navigator.serviceWorker.ready) return;
    const agora = Date.now();
    if (!forcar && agora - ultimaNotifTimerMs < 4000) return; // evita spam (atualiza ~a cada 4s)
    ultimaNotifTimerMs = agora;
    notifTimerAtiva = true;
    navigator.serviceWorker.ready.then(function (reg) {
      reg.showNotification(nomeTopicoCompleto(e.topicoId) || 'Estudo em andamento', {
        tag: TAG_NOTIF_TIMER,
        body: textoNotifTimer(e),
        icon: 'icons/icone-192.png',
        badge: 'icons/icone-192.png',
        silent: true,
        renotify: false,
        requireInteraction: true
      }).catch(function () {});
    }).catch(function () {});
  }

  function limparNotificacaoTimer() {
    ultimaNotifTimerMs = 0;
    if (!notifTimerAtiva) return;
    notifTimerAtiva = false;
    if (!('Notification' in window) || !navigator.serviceWorker) return;
    navigator.serviceWorker.ready.then(function (reg) {
      reg.getNotifications({ tag: TAG_NOTIF_TIMER }).then(function (ns) {
        ns.forEach(function (n) { n.close(); });
      }).catch(function () {});
    }).catch(function () {});
  }

  function atualizarTituloTimer(e) {
    if (!e) {
      document.title = TITULO_PADRAO;
      limparNotificacaoTimer();
      return;
    }
    if (e.limiteAvisado && e.limiteRestanteMs === 0) {
      document.title = 'Tempo maximo atingido · Estudos';
      return;
    }
    const ms = e.modo === 'pomodoro' ? e.pomoRestanteMs : e.decorridoMs;
    document.title = window.Timer.formatar(ms) + (e.rodando ? ' · Estudos' : ' pausado · Estudos');
  }

  function avisarLimiteTimer(e) {
    tocarAlarme(5);
    toast('Tempo máximo atingido: ' + e.limiteMin + ' min.', 'sucesso');
    // O construtor direto da API de notificações lança TypeError na maioria dos navegadores móveis.
    // O helper usa ServiceWorkerRegistration.showNotification(), suportado em PWA.
    mostrarNotificacaoTimer(e, true);
  }

  function tratarTickTimer(e) {
    atualizarTituloTimer(e);
    if (e && e.limiteAtingido) avisarLimiteTimer(e);
    if (e && e.pomoTrocouFase) {
      tocarAlarme(5);                                    // alerta de ~5s ao virar a fase (foco/pausa)
      toast(e.pomoFase === 'foco' ? 'Pausa encerrada — de volta ao foco' : 'Foco concluído — 5 min de pausa', 'sucesso');
    }
    if (pintarTimerAtual && location.hash.replace('#', '') === 'timer') pintarTimerAtual(e);
    if (pintarTimerModal) pintarTimerModal(e);
    // Contador na bandeja quando o app está em segundo plano (oculto).
    if (e && e.rodando && document.hidden) mostrarNotificacaoTimer(e);
    else limparNotificacaoTimer();
  }

  // O cronômetro guardado aponta para um tópico que não existe mais em NENHUM
  // plano salvo? Então ele ficou órfão (o plano dele foi excluído/trocado) e o
  // tempo não tem onde ser registrado: o app mostrava uma sessão pausada eterna,
  // com o id cru do tópico ("ADM-U1"), sem forma de encerrar.
  function timerOrfao(e) {
    if (!e || !e.topicoId || e.topicoId === ID_SIM_TIMER) return false;
    return !D.topicoExisteEmAlgumPlano(state, e.topicoId);
  }

  // Descarta o cronômetro órfão. Só age com o estado local já carregado
  // (`temDados`): num aparelho que ainda espera a nuvem, os planos podem chegar
  // depois — nesse caso o timer fica de pé e é reavaliado após o sync.
  function sanearTimerOrfao(opcoes) {
    opcoes = opcoes || {};
    if (!window.Timer) return false;
    const e = window.Timer.estado();
    if (!timerOrfao(e)) return false;
    if (!opcoes.forcar && !window.Store.temDados(state)) return false;
    window.Timer.descartar();
    atualizarTituloTimer(null);
    if (!opcoes.silencioso) toast('O cronômetro pausado era de um plano excluído — descartado.', 'sucesso');
    return true;
  }

  function confete() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cores = ['#2148C0', '#1E7D46', '#C03B2B', '#9A6B00'];
    for (let i = 0; i < 22; i++) {
      const c = document.createElement('div');
      c.className = 'confete';
      c.style.background = cores[i % cores.length];
      c.style.left = (35 + Math.random() * 30) + 'vw';
      c.style.bottom = (20 + Math.random() * 20) + 'vh';
      c.style.animationDelay = (Math.random() * 0.25) + 's';
      document.body.appendChild(c);
      setTimeout(function () { c.remove(); }, 1400);
    }
  }

  function tagDisc(disc) {
    return '<span class="tag-disc" style="background:' + esc(disc.cor) + '">' + esc(disc.id) + '</span>';
  }

  // Nome de exibição da disciplina sem o prefixo "Noções de / Noções Dir." —
  // na prática nunca é só noção e o prefixo só ocupa espaço.
  function nomeDiscCurto(nome) {
    let s = String(nome || '');
    s = s.replace(/^No[çc][õo]es\s+Dir\.\s*/i, 'Direito ');
    s = s.replace(/^No[çc][õo]es\s+de\s+/i, '');
    s = s.replace(/^No[çc][õo]es\s+/i, '');
    return s.trim() || String(nome || '');
  }

  function bolha(status, extra) {
    return '<span class="bolha bolha-' + esc(status) + (extra ? ' ' + extra : '') + '" aria-hidden="true"></span>';
  }

  function semaforoHtml(pct, meta) {
    if (pct === null || pct === undefined) return '<span class="semaforo" style="color:var(--grafite)">—</span>';
    const cor = D.semaforo(pct, meta);
    const simbolo = cor === 'verde' ? ' ✓' : cor === 'amarelo' ? ' ⚠' : ' ✗';
    return '<span class="semaforo semaforo-' + cor + '">' + pct + '%' + simbolo + '</span>';
  }

  function pizzaAcertosHtml(certas, erros, opcoes) {
    opcoes = opcoes || {};
    certas = Math.max(0, parseInt(certas || 0, 10));
    erros = Math.max(0, parseInt(erros || 0, 10));
    const total = certas + erros;
    const pct = total > 0 ? Math.round((certas / total) * 100) : 0;
    const classe = opcoes.classe ? ' ' + opcoes.classe : '';
    const titulo = (opcoes.titulo ? opcoes.titulo + ' - ' : '') + pct + '% de acertos | ' + certas + ' acertos | ' + erros + ' erros';
    return '<span class="pizza-acertos' + classe + '" style="--pct:' + pct + '" title="' + esc(titulo) + '" aria-label="' + esc(titulo) + '">' +
      '<span class="pizza-centro">' + pct + '%</span></span>';
  }

  function tagIncidenciaHtml(valor, quente) {
    const n = Math.max(0, parseInt(valor || 0, 10));
    return '<span class="tag-incidencia' + (quente ? ' tag-incidencia-hot' : '') + '" title="Incidência estimada nas provas">' +
      (quente ? '🔥 ' : '') + n + '%</span>';
  }

  // IDs dos tópicos mais recorrentes (maior incidência) DE CADA disciplina — ganham 🔥.
  // Por disciplina (não global) para que toda matéria destaque os seus campeões
  // de incidência, ex.: Constitucional também marca os dela.
  function idsTopicosQuentes(topicos, limite) {
    limite = limite || 3;
    const todos = (topicos || [])
      .filter(function (t) { return !t.orfao; })
      .map(function (t) { return { id: t.id, inc: t.incidencia_pct || 0 }; })
      .sort(function (a, b) { return b.inc - a.inc; });
    const set = new Set();
    todos.slice(0, limite).forEach(function (t) { if (t.inc > 0) set.add(t.id); });
    return set;
  }

  function nomeTopicoCompleto(topicoId) {
    const t = D.topicoPorId(state, topicoId);
    const d = D.disciplinaDoTopico(state, topicoId);
    if (!t) return topicoId;
    return (d ? d.id + ' · ' : '') + t.nome;
  }

  function doAtivo(lista) { return D.doPlanoAtivo(state, lista); }

  // Horas REALMENTE agendadas (blocos do calendário) numa semana — é o número
  // que o aluno vê no calendário. Usado no check-in para bater com a agenda.
  function horasAgendadasSemana(inicioISO) {
    const fim = D.addDias(inicioISO, 7);
    let min = 0;
    doAtivo(state.agenda).forEach(function (a) {
      if (a.data >= inicioISO && a.data < fim) min += a.duracaoMin || 0;
    });
    return Math.round((min / 60) * 10) / 10;
  }

  function normalizarCicloAtivoPelaRotina() {
    const ciclo = state.plano && state.plano.ciclo;
    if (!ciclo || !Array.isArray(ciclo.blocos)) return false;
    const rotina = rotinaEstudosAtual();
    const maxBloco = Math.max(rotina.minBloco || 30, rotina.maxBloco || 75);
    let mudou = false;
    ciclo.blocos.forEach(function (b) {
      if ((b.metaMin || 0) > maxBloco) {
        b.metaMin = maxBloco;
        if ((b.feitoMin || 0) > maxBloco) b.feitoMin = maxBloco;
        mudou = true;
      }
    });
    if (mudou) salvar();
    return mudou;
  }

  function primeiroNome(valor) {
    return String(valor || '').trim().split(/\s+/)[0] || '';
  }

  function nomeUsuario() {
    return primeiroNome(state.config && state.config.nomeUsuario) ||
      primeiroNome(firebaseStatus && firebaseStatus.usuario && firebaseStatus.usuario.nome) ||
      primeiroNome(firebaseStatus && firebaseStatus.usuario && firebaseStatus.usuario.email) ||
      'Fulano(a)';
  }

  function recordeAntesDeHoje(sessoes, hoje) {
    const ontem = D.addDias(hoje, -1);
    return D.streak(sessoes.filter(function (s) { return s.data < hoje; }), ontem).recorde;
  }

  function emojisConstancia(st, recordeAnterior) {
    const emojis = [];
    if (st.atual >= 7) emojis.push('🎉');
    if (st.atual > 0 && st.atual > recordeAnterior) emojis.push('🏆');
    return emojis.length ? '<span class="streak-emojis" aria-hidden="true">' + emojis.join('') + '</span>' : '';
  }

  function saudacaoCompleta(saudacao) {
    if (modoDemo) return saudacao;
    // esc: o nome é texto livre (perfil/ajustes ou displayName do Google) e vai
    // direto para innerHTML no <h1> — sem escapar seria XSS armazenado/sincronizado.
    const nome = nomeUsuario();
    return nome ? saudacao + ', ' + esc(nome) : saudacao;
  }

  function cortesDoPlanoAtivo() {
    if (!state.plano || !state.plano.meta) return null;
    const meta = state.plano.meta;
    const normalizar = function (cortes) {
      if (!cortes || typeof cortes !== 'object') return null;
      const ampla = cortes.ampla != null ? cortes.ampla : meta.corte_pct;
      const negros = cortes.negros != null ? cortes.negros : (cortes.cn != null ? cortes.cn : null);
      const pcd = cortes.pcd != null ? cortes.pcd : null;
      if (ampla == null && negros == null && pcd == null) return null;
      return { ampla: ampla, negros: negros, pcd: pcd };
    };
    const doMeta = normalizar(meta.cortes || meta.cortes_pct || null);
    if (doMeta) return doMeta;
    const edital = state.plano && state.plano.concurso
      ? editaisDoCatalogo().find(function (e) { return e && e.titulo === state.plano.concurso; })
      : null;
    const doEdital = edital
      ? normalizar(edital.cortes || { ampla: edital.notaCorte, negros: null, pcd: null })
      : null;
    if (doEdital) return doEdital;
    return { ampla: meta.corte_pct != null ? meta.corte_pct : 70, negros: null, pcd: null };
  }

  function hojeMesISO() {
    const hoje = D.hojeISO();
    return hoje.slice(0, 7);
  }

  // Seletor de MÊS (mês/ano) com dois dropdowns no tema do app — substitui o
  // input[type=month] nativo (cujo popup não dá para estilizar). Mantém um input
  // hidden#id com o valor "AAAA-MM" para o código existente continuar lendo .value.
  const MESES_PT_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function seletorMesHtml(id, valor, opcoes) {
    opcoes = opcoes || {};
    valor = /^\d{4}-\d{2}/.test(valor || '') ? valor.slice(0, 7) : '';
    const mm = valor ? valor.slice(5, 7) : '';
    const aa = valor ? valor.slice(0, 4) : '';
    const anoBase = new Date().getFullYear();
    let aMin = anoBase - 1, aMax = anoBase + 8;
    if (aa) { aMin = Math.min(aMin, +aa); aMax = Math.max(aMax, +aa); }
    const optVazio = opcoes.opcional ? '<option value="">—</option>' : '';
    let optsMes = optVazio;
    MESES_PT_CURTO.forEach(function (nm, i) {
      const v = String(i + 1).padStart(2, '0');
      optsMes += '<option value="' + v + '"' + (v === mm ? ' selected' : '') + '>' + nm + '</option>';
    });
    let optsAno = optVazio;
    for (let y = aMax; y >= aMin; y--) {
      optsAno += '<option value="' + y + '"' + (String(y) === aa ? ' selected' : '') + '>' + y + '</option>';
    }
    return '<div class="seletor-mes" data-seletor-mes>' +
      '<select class="sm-mes" aria-label="Mês">' + optsMes + '</select>' +
      '<select class="sm-ano" aria-label="Ano">' + optsAno + '</select>' +
      '<input type="hidden" id="' + esc(id) + '" value="' + esc(valor) + '"></div>';
  }
  // Liga os seletores de mês de um container: compõe AAAA-MM no hidden e dispara
  // 'change' (para os handlers existentes que escutam o input continuarem valendo).
  function ligarSeletoresMes(raiz) {
    (raiz || document).querySelectorAll('[data-seletor-mes]').forEach(function (wrap) {
      if (wrap.dataset.ligado) return;
      wrap.dataset.ligado = '1';
      const mes = wrap.querySelector('.sm-mes');
      const ano = wrap.querySelector('.sm-ano');
      const hid = wrap.querySelector('input[type="hidden"]');
      function sync() {
        hid.value = (mes.value && ano.value) ? ano.value + '-' + mes.value : '';
        hid.dispatchEvent(new Event('change', { bubbles: true }));
      }
      mes.addEventListener('change', sync);
      ano.addEventListener('change', sync);
    });
  }

  function ultimoDiaMesISO(aaaaMM) {
    if (!aaaaMM || !/^\d{4}-\d{2}$/.test(aaaaMM)) return null;
    const partes = aaaaMM.split('-').map(Number);
    const dt = new Date(partes[0], partes[1], 0);
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }

  // 25.9 semanas é difícil de visualizar: vira "25 semanas e 6 dias".
  function formatarSemanasDias(semanasDecimais) {
    const totalDias = Math.max(0, Math.round((parseFloat(semanasDecimais) || 0) * 7));
    const semanas = Math.floor(totalDias / 7);
    const dias = totalDias - semanas * 7;
    // espaço inquebrável entre número e unidade: no mobile "2 dias" não se separa
    // (a palavra "dias" não fica sozinha na linha de baixo).
    const ESP = String.fromCharCode(160);
    const nb = function (n, s, p) { return n + ESP + (n === 1 ? s : p); };
    if (semanas === 0) return nb(dias, 'dia', 'dias');
    if (dias === 0) return nb(semanas, 'semana', 'semanas');
    return nb(semanas, 'semana', 'semanas') + ' e ' + nb(dias, 'dia', 'dias');
  }

  // Quebra um total de dias em meses, semanas e dias (aproximação de mês = 30 dias)
  // para o detalhamento que aparece ao passar o mouse no widget de calendário.
  function decomporDias(diasTotais) {
    let dias = Math.max(0, parseInt(diasTotais, 10) || 0);
    const meses = Math.floor(dias / 30);
    dias -= meses * 30;
    const semanas = Math.floor(dias / 7);
    dias -= semanas * 7;
    return { meses: meses, semanas: semanas, dias: dias };
  }

  function plural(n, sing, plur) {
    return n + ' ' + (n === 1 ? sing : plur);
  }

  function countdownDetalhado(diasTotais) {
    const d = decomporDias(diasTotais);
    const partes = [];
    if (d.meses) partes.push(plural(d.meses, 'mês', 'meses'));
    if (d.semanas) partes.push(plural(d.semanas, 'semana', 'semanas'));
    if (d.dias || partes.length === 0) partes.push(plural(d.dias, 'dia', 'dias'));
    let txt;
    if (partes.length === 1) txt = partes[0];
    else if (partes.length === 2) txt = partes[0] + ' e ' + partes[1];
    else txt = partes[0] + ', ' + partes[1] + ' e ' + partes[2];
    return 'faltam ≈ ' + txt;
  }

  // Widget de calendário animado: número de dias em destaque no centro,
  // período + detalhamento (meses/semanas/dias) ao passar o mouse.
  function calendarioCountdownHtml(janela, periodo) {
    if (!janela || !janela[0] || !janela[1]) {
      return '<div class="prova-status-pill">sem data definida</div>';
    }
    const hoje = D.hojeISO();
    const inicio = janela[0] + '-01';
    const fim = ultimoDiaMesISO(janela[1]);
    if (!fim) return '<div class="prova-status-pill">sem data definida</div>';
    if (hoje >= inicio && hoje <= fim) {
      return '<div class="prova-status-pill prova-status-ativo">📝 janela da prova em andamento</div>';
    }
    if (hoje > fim) {
      const passou = D.diffDias(fim, hoje);
      return '<div class="prova-status-pill">janela passou há ' + plural(passou, 'dia', 'dias') + '</div>';
    }
    const dias = D.diffDias(hoje, inicio);
    const detalhe = countdownDetalhado(dias) + ' para a prova';
    const temPeriodo = periodo && periodo !== 'Definir período';
    const aria = (temPeriodo ? periodo + ' · ' : '') + detalhe;
    const mesAlvo = D.formatarMesBR(janela[0]).split(' ')[0].toUpperCase();
    return '<div class="cal-countdown" tabindex="0" role="img" aria-label="' + esc(aria) + '">' +
      '<div class="cal-widget">' +
      '<span class="cal-anel cal-anel-e" aria-hidden="true"></span>' +
      '<span class="cal-anel cal-anel-d" aria-hidden="true"></span>' +
      '<div class="cal-top">' + esc(mesAlvo) + '</div>' +
      '<div class="cal-body"><span class="cal-num">' + dias + '</span>' +
      '<span class="cal-unidade">' + (dias === 1 ? 'dia' : 'dias') + '</span></div>' +
      '</div>' +
      '<div class="cal-tooltip" role="tooltip">' +
      (temPeriodo ? '<span class="cal-tooltip-periodo">' + esc(periodo) + '</span>' : '') +
      '<span>' + esc(detalhe) + '</span></div>' +
      '</div>';
  }

  function checkEstudoHtml(feito, acao, id, tipo, titulo) {
    if (feito) {
      const sessaoRapida = registroRapidoParaDesfazer(acao, id, tipo);
      if (sessaoRapida) {
        return '<button type="button" class="check-estudo check-estudo-feito" data-check-desfazer="' + esc(acao) + '" data-id="' + esc(id) + '"' +
          (tipo ? ' data-tipo="' + esc(tipo) + '"' : '') +
          ' title="Desfazer registro rápido" aria-label="Desfazer registro rápido: ' + esc(titulo || '') + '">✓</button>';
      }
      return '<span class="check-estudo check-estudo-feito" title="Estudo registrado" aria-label="Estudo registrado">✓</span>';
    }
    // A bolinha de blocos/agenda faz registro RÁPIDO (1 toque): assume o tempo
    // planejado, 0 questões e NÃO conclui a teoria — isso fica para "Registrar"
    // (detalhes). Revisão mantém o fluxo de concluir com bolha.
    const rapido = acao === 'registrar' || acao === 'concluir-agenda';
    const attr = rapido
      ? 'data-check-rapido="' + esc(acao) + '"'
      : 'data-acao="' + esc(acao) + '"';
    return '<button type="button" class="check-estudo" ' + attr + ' data-id="' + esc(id) + '"' +
      (tipo ? ' data-tipo="' + esc(tipo) + '"' : '') +
      ' title="' + (rapido ? 'Marcar como estudado (registro rápido)' : 'Registrar estudo') + '" aria-label="Registrar estudo: ' + esc(titulo || '') + '"></button>';
  }

  function registroRapidoParaDesfazer(kind, id, tipo) {
    if (kind === 'concluir-agenda') {
      const b = state.agenda.find(function (a) { return a.id === id; });
      if (!b || !b.registroRapidoId) return null;
      return state.sessoes.find(function (s) { return s.id === b.registroRapidoId && s.origemRegistroRapido === 'fila'; }) || null;
    }
    if (kind !== 'registrar') return null;
    const hoje = D.hojeISO();
    const tipoBusca = tipo || 'teoria';
    // O check verde de um "bloco da semana" (blocoFeito) liga para QUALQUER
    // sessão do tópico na semana corrente — não só a de hoje. Para que o ✓
    // seja sempre desfazível (e não vire um <span> morto quando o registro
    // rápido foi num dia anterior da mesma semana), buscamos na mesma janela.
    // Continua restrito a origemRegistroRapido === 'fila' (registro detalhado/
    // timer não vira desfazer de 1 toque) e prioriza a sessão de hoje.
    const inicioSemana = D.segundaDaSemana(hoje);
    const fimSemana = D.addDias(inicioSemana, 7);
    const candidatas = state.sessoes.filter(function (s) {
      return s.origemRegistroRapido === 'fila' &&
        s.topicoId === id &&
        s.tipo === tipoBusca &&
        s.data >= inicioSemana && s.data < fimSemana &&
        (!state.planoAtivoId || s.planoId === state.planoAtivoId);
    });
    if (candidatas.length === 0) return null;
    return candidatas.filter(function (s) { return s.data === hoje; }).pop() ||
      candidatas[candidatas.length - 1];
  }

  // Registro rápido pela bolinha: cria a sessão com padrões e dá o "check verde".
  function registrarRapidoFila(el, kind, id, tipo) {
    if (!el || el.disabled) return;
    el.classList.add('check-estudo-feito', 'check-pop');
    el.textContent = '✓';
    el.disabled = true;
    if (kind === 'concluir-agenda') {
      const b = state.agenda.find(function (a) { return a.id === id; });
      if (!b) { render(); return; }
      const disc = D.disciplinaPorId(state, b.disciplinaId);
      const topId = b.topicoId || (disc && disc.topicos[0] ? disc.topicos[0].id : null);
      const t = b.obs === 'questoes' ? 'questoes' : b.obs === 'revisao' ? 'revisao' : 'teoria';
      // Marca o bloco como concluído: registra só o tempo que ainda FALTAVA (não
      // duplica o que já foi cronometrado em sessões parciais) e fecha o bloco.
      // Sempre cria a sessão (mesmo sem tópico resolvido, topId null) para que as
      // horas do dia/semana somem — antes, um bloco sem tópico era riscado mas
      // não contava nas horas.
      const restante = blocoRestanteMin(b) || (b.duracaoMin || 30);
      const sessao = concluirRegistro({ topicoId: topId, tipo: t, duracaoMin: restante, qFeitas: 0, qCertas: 0, teoriaOk: false, origemRegistroRapido: 'fila', data: b.data, blocoId: b.id, semRender: true });
      if (sessao) b.registroRapidoId = sessao.id;
      b.feitoMin = b.duracaoMin || 0;
      b.feito = true;
      salvar();
    } else { // registrar (bloco da semana / reaberto)
      concluirRegistro({ topicoId: id, tipo: tipo || 'teoria', duracaoMin: 30, qFeitas: 0, qCertas: 0, teoriaOk: false, origemRegistroRapido: 'fila', semRender: true });
    }
    setTimeout(render, 420); // deixa a animação do check rodar antes de redesenhar
  }

  function desfazerRegistroRapidoFila(kind, id, tipo) {
    const sessao = registroRapidoParaDesfazer(kind, id, tipo);
    if (!sessao) {
      toast('Esse item foi registrado por outro caminho. Abra o histórico para remover.', 'erro');
      return;
    }
    state.sessoes = state.sessoes.filter(function (s) { return s.id !== sessao.id; });
    window.Store.marcarRemovido(state, sessao.id); // desfazer também não pode ser ressuscitado pelo sync
    if (kind === 'concluir-agenda') {
      const b = state.agenda.find(function (a) { return a.id === id; });
      if (b) {
        b.feito = false;
        b.feitoMin = 0;
        delete b.registroRapidoId;
      }
    }
    const t = D.topicoPorId(state, sessao.topicoId);
    const aindaTemSessao = D.sessoesDoPlano(state).some(function (s) { return s.topicoId === sessao.topicoId; });
    if (t && t.status === 'em_curso' && !aindaTemSessao) t.status = 'pendente';
    salvar();
    render();
    toast('Registro rápido desfeito', 'sucesso');
  }

  function tituloCurto(t) {
    const s = String(t || '');
    return s.split(/\s[—–-]\s/)[0].trim() || s || 'Plano';
  }

  // Nome curto do concurso (antes do primeiro traço): "TRF3 — Técnico…" -> "TRF3"
  function nomeCurtoConcurso() {
    const c = state.plano ? (state.plano.concurso || '') : '';
    const curto = c.split(/\s[—–-]\s/)[0].trim();
    return curto || c || 'prova';
  }

  function provaEstimadaConteudoHtml() {
    const radar = state.plano && state.plano.radar;
    const janela = radar && radar.janela_prova;
    const periodo = janela && janela[0] && janela[1]
      ? D.formatarMesBR(janela[0]) + ' – ' + D.formatarMesBR(janela[1])
      : 'Definir período';
    const reavaliar = radar && radar.reavaliar_em ? D.formatarDataBR(radar.reavaliar_em) : '';
    return '<div class="prova-card-topo"><span class="alvo-emoji" aria-hidden="true">🎯</span>' +
      '<div class="card-kpi-rotulo">Data provável · ' + esc(nomeCurtoConcurso()) + '</div></div>' +
      calendarioCountdownHtml(janela, periodo) +
      (reavaliar ? '<div class="card-kpi-extra">reavaliar em ' + esc(reavaliar) + '</div>' : '') +
      '<button type="button" class="botao-mini botao-quieto prova-editar">Editar</button>';
  }

  function provaEstimadaHtml() {
    return '<div class="card card-kpi prova-card">' + provaEstimadaConteudoHtml() + '</div>';
  }

  function linksApoioHojeHtml() {
    return '';
  }

  function chaveBlocoVinculado(inicioSemana, topicoId, tipo) {
    return inicioSemana + '|' + topicoId + '|' + (tipo || 'teoria');
  }

  function vincularBlocoEstudado(topicoId, tipo, inicioSemana) {
    const fim = D.addDias(inicioSemana, 7);
    const sessao = D.sessoesDoPlano(state).find(function (s) {
      return s.topicoId === topicoId && s.data >= inicioSemana && s.data < fim;
    });
    if (!sessao) {
      toast('Não encontrei estudo anterior deste tópico nesta semana. Vou abrir o registro.', 'erro');
      abrirRegistro({ topicoId: topicoId, tipo: tipo || 'teoria' });
      return;
    }
    state.config.blocosVinculados = state.config.blocosVinculados || [];
    const chave = chaveBlocoVinculado(inicioSemana, topicoId, tipo);
    if (state.config.blocosVinculados.indexOf(chave) < 0) state.config.blocosVinculados.push(chave);
    salvar();
    render();
    toast('Estudo de ' + D.formatarDataBR(sessao.data) + ' vinculado ao plano', 'sucesso');
  }

  function abrirEditarProva() {
    if (!state.plano) {
      toast('Crie ou importe um plano antes de definir a prova.', 'erro');
      return;
    }
    const radar = state.plano.radar || {};
    const janela = radar.janela_prova || [hojeMesISO(), hojeMesISO()];
    const m = abrirModal(
      '<h3>Editar prova</h3>' +
      '<form id="form-prova">' +
      '<label for="pv-nome">Nome da prova</label>' +
      '<input id="pv-nome" type="text" maxlength="80" value="' + esc(state.plano.concurso || '') + '" placeholder="Ex.: TRF3 — Técnico Judiciário">' +
      '<div class="grade-2">' +
      '<div><label for="pv-inicio">Início do período</label>' + seletorMesHtml('pv-inicio', janela[0] || hojeMesISO()) + '</div>' +
      '<div><label for="pv-fim">Fim do período</label>' + seletorMesHtml('pv-fim', janela[1] || janela[0] || hojeMesISO()) + '</div></div>' +
      '<label for="pv-reav">Reavaliar em</label><input id="pv-reav" type="date" value="' + esc(radar.reavaliar_em || '') + '">' +
      '<div class="msg-erro oculto" id="pv-erro"></div>' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="pv-cancelar">Cancelar</button>' +
      '<button type="submit">Salvar</button></div></form>'
    );
    ligarSeletoresMes(m);
    m.querySelector('#pv-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#form-prova').addEventListener('submit', function (e) {
      e.preventDefault();
      const inicio = m.querySelector('#pv-inicio').value;
      const fim = m.querySelector('#pv-fim').value;
      const erro = m.querySelector('#pv-erro');
      if (!inicio || !fim || fim < inicio) {
        erro.textContent = 'O fim do período precisa ser igual ou posterior ao início.';
        erro.classList.remove('oculto');
        return;
      }
      const nome = (m.querySelector('#pv-nome').value || '').trim();
      if (nome) state.plano.concurso = nome;
      state.plano.radar = Object.assign({}, radar, {
        janela_prova: [inicio, fim],
        reavaliar_em: m.querySelector('#pv-reav').value || null
      });
      salvar();
      fecharModal();
      render();
      toast('Prova atualizada', 'sucesso');
    });
  }

  // ---------------- revisões: agendar/cancelar coerente ----------------
  function agendarRevisoesSeNecessario(topicoId) {
    const tem = doAtivo(state.revisoes).some(function (r) { return r.topicoId === topicoId; });
    if (!tem) {
      const novas = D.agendarRevisoes(topicoId, D.hojeISO(), { intervalos: D.intervalosRevisaoConfig(state) });
      novas.forEach(function (r) { r.planoId = state.planoAtivoId; });
      state.revisoes = state.revisoes.concat(novas);
      return true;
    }
    return false;
  }

  // Agenda revisões para vários tópicos "já estudados" de uma vez (ponto de
  // partida, modo aprofundar, plano de exemplo). Difere do estudo real do dia:
  // como NÃO houve estudo ontem, pula a revisão de 24h E escalona a data-base
  // entre os tópicos — assim a curva não empilha num único dia (era o que
  // entupia o calendário com dezenas de "24h" no mesmo dia). Idempotente.
  const REVISOES_LOTE_POR_DIA = 3; // tópicos por dia-base → ~3 revisões/dia
  function agendarRevisoesEmLote(topicoIds) {
    let i = 0, agendou = 0;
    (topicoIds || []).forEach(function (id) {
      if (doAtivo(state.revisoes).some(function (r) { return r.topicoId === id; })) return;
      const base = D.addDias(D.hojeISO(), Math.floor(i / REVISOES_LOTE_POR_DIA));
      const novas = D.agendarRevisoes(id, base, { pular24h: true, intervalos: D.intervalosRevisaoConfig(state) });
      novas.forEach(function (r) { r.planoId = state.planoAtivoId; });
      state.revisoes = state.revisoes.concat(novas);
      i++; agendou++;
    });
    return agendou;
  }

  // Migração: planos criados ANTES da correção do "ponto de partida" têm dezenas
  // de revisões empilhadas no mesmo dia — a curva completa de cada tópico marcado
  // como "já estudei/domino" foi ancorada na mesma data (com 24h e tudo), porque
  // a versão antiga agendava revisão a partir de uma data passada inventada. Isso
  // entope o calendário. No modelo novo a curva só nasce de estudo real, então
  // aqui: (1) removemos essas revisões em massa e (2) devolvemos os tópicos à fila
  // (status pendente + bagagem), para o aluno fazer a 1ª passada e a curva começar
  // daí. Por fim regeneramos o cronograma para esses tópicos reaparecerem.
  // Guardas: só age quando há pilha de fato e só em tópicos NUNCA estudados (sem
  // sessão) e SEM revisão concluída. Flag por plano evita reprocessar a cada load.
  const LIMIAR_PILHA_REV = 6; // mais que isso no mesmo dia = parede
  function migrarRevisoesEmPilha() {
    if (!state.planoAtivoId || !state.plano) return 0;
    if (state.plano.revisoesRedistribuidasEm) return 0; // já migrado
    const ativos = doAtivo(state.revisoes).filter(function (r) {
      return r && !r.dataConcluida && D.topicoPorId(state, r.topicoId);
    });
    if (ativos.length === 0) return 0;
    // há parede? algum dia concentra muitas revisões pendentes
    const porDia = {};
    ativos.forEach(function (r) { porDia[r.dataAgendada] = (porDia[r.dataAgendada] || 0) + 1; });
    const temPilha = Object.keys(porDia).some(function (d) { return porDia[d] > LIMIAR_PILHA_REV; });
    if (!temPilha) return 0;
    // tópicos "tocados" (estudados de verdade ou com revisão concluída) ficam de fora
    const tocado = {};
    doAtivo(state.revisoes).forEach(function (r) { if (r && r.dataConcluida) tocado[r.topicoId] = true; });
    doAtivo(state.sessoes).forEach(function (s) { if (s && s.topicoId) tocado[s.topicoId] = true; });
    const alvoSet = {};
    ativos.forEach(function (r) { if (!tocado[r.topicoId]) alvoSet[r.topicoId] = true; });
    const alvos = Object.keys(alvoSet);
    if (!alvos.length) return 0;
    // 1) remove as revisões em massa desses tópicos (pendentes, no plano ativo)
    window.Store.marcarRemovido(state, state.revisoes.filter(function (r) {
      const noAtivo = r && (!r.planoId || r.planoId === state.planoAtivoId);
      return noAtivo && !r.dataConcluida && alvoSet[r.topicoId];
    }).map(function (r) { return r.id; }));
    state.revisoes = state.revisoes.filter(function (r) {
      if (!r) return false;
      const noAtivo = !r.planoId || r.planoId === state.planoAtivoId;
      return !(noAtivo && !r.dataConcluida && alvoSet[r.topicoId]);
    });
    // 2) devolve os tópicos à fila: o status concluído/dominado vira pendente e
    //    guarda a bagagem para deprioridade e esforço reduzido.
    alvos.forEach(function (id) {
      const t = D.topicoPorId(state, id);
      if (!t) return;
      if (t.status === 'dominado') t.bagagem = 'domino';
      else if (t.status === 'teoria_concluida') t.bagagem = 'estudei';
      t.status = 'pendente';
    });
    state.plano.revisoesRedistribuidasEm = D.hojeISO();
    // 3) regenera o cronograma para os tópicos devolvidos reaparecerem na fila.
    if (state.plano.ritmos && state.plano.ritmoAtivo) recalcularPlanoAdaptativo(true);
    return alvos.length;
  }

  // Conclui a teoria de um tópico. Se há um cronômetro em andamento DESTE tópico,
  // finaliza e registra a sessão (assim o tempo de hoje conta na carga diária e o
  // bloco aparece riscado no calendário) — além de agendar as revisões. Sem timer
  // ativo, apenas marca a teoria como concluída e agenda revisões.
  // Retorna true se registrou tempo de estudo (havia timer do tópico).
  function concluirTopicoTeoria(topicoId) {
    const t = D.topicoPorId(state, topicoId);
    if (!t) return false;
    const tEstado = window.Timer.estado();
    if (tEstado && tEstado.topicoId === topicoId && minutosEstudoTimer(tEstado) >= 1) {
      window.Timer.finalizar();
      atualizarTituloTimer(null);
      // concluirRegistro já cria a sessão, marca teoria_concluida, agenda revisões,
      // credita o ciclo e salva.
      concluirRegistro({ topicoId: topicoId, tipo: 'teoria', duracaoMin: Math.max(1, minutosEstudoTimer(tEstado)), qFeitas: 0, qCertas: 0, teoriaOk: true });
      return true;
    }
    if (t.status !== 'dominado') t.status = 'teoria_concluida';
    agendarRevisoesSeNecessario(topicoId);
    salvar();
    return false;
  }

  function removerRevisoesPendentes(topicoId) {
    const removidas = state.revisoes.filter(function (r) {
      return r.topicoId === topicoId && !r.dataConcluida;
    }).map(function (r) { return r.id; });
    window.Store.marcarRemovido(state, removidas);
    state.revisoes = state.revisoes.filter(function (r) {
      return r.topicoId !== topicoId || r.dataConcluida;
    });
  }

  async function sairDaContaComSeguranca(botao) {
    if (!window.FirebaseSync) {
      toast('Sincronização indisponível.', 'erro');
      return;
    }
    if (navigator.onLine === false) {
      toast('Conecte-se à internet para salvar tudo antes de sair.', 'erro');
      return;
    }
    const ok = await confirmar({
      titulo: 'Sair desta conta?',
      mensagem: 'As alterações serão sincronizadas e os dados deste perfil serão removidos deste aparelho.',
      confirmar: 'Sincronizar e sair',
      icone: '🔒'
    });
    if (!ok) return;
    if (botao) botao.disabled = true;
    try {
      await window.FirebaseSync.logout({
        sincronizarAntes: true,
        antesDeSair: function () {
          if (window.Timer) window.Timer.descartar();
          if (window.Sync && window.Sync.parar) window.Sync.parar();
          atualizarTituloTimer(null);
          window.Store.limparLocal();
          localStorage.removeItem(CHAVE_ULTIMO_USUARIO);
          state = window.Store.estadoVazio();
          modoOfflineLocal = false;
        }
      });
      fecharModal();
      render();
      toast('Conta desconectada e dados locais removidos.', 'sucesso');
    } catch (e) {
      toast(e && e.message ? e.message : 'Não consegui sair agora.', 'erro');
    } finally {
      if (botao && document.contains(botao)) botao.disabled = false;
    }
  }

  // ---------------- registro de sessão (F1, ≤3 toques) ----------------
  function abrirRegistro(opcoes) {
    opcoes = opcoes || {};
    if (state.disciplinas.length === 0) {
      toast('Importe um plano antes de registrar sessões.', 'erro');
      location.hash = '#ajustes';
      return;
    }
    const topicoIni = opcoes.topicoId || null;
    const discIni = topicoIni ? D.disciplinaDoTopico(state, topicoIni)
      : (opcoes.disciplinaId ? D.disciplinaPorId(state, opcoes.disciplinaId) : null) || state.disciplinas[0];

    const optsDisc = state.disciplinas.map(function (d) {
      return '<option value="' + esc(d.id) + '"' + (discIni && d.id === discIni.id ? ' selected' : '') + '>' + esc(d.id + ' — ' + d.nome) + '</option>';
    }).join('');

    const m = abrirModal(
      '<h3>Registrar sessão</h3>' +
      '<form id="form-registro">' +
      '<label for="reg-disc">Disciplina</label><select id="reg-disc">' + optsDisc + '</select>' +
      '<label for="reg-topico">Tópico</label><select id="reg-topico"></select>' +
      '<div class="grade-2">' +
      '<div><label for="reg-tipo">Tipo</label><select id="reg-tipo">' +
      '<option value="teoria"' + (opcoes.tipo === 'teoria' ? ' selected' : '') + '>Teoria</option>' +
      '<option value="questoes"' + (opcoes.tipo === 'questoes' ? ' selected' : '') + '>Questões</option>' +
      '<option value="revisao"' + (opcoes.tipo === 'revisao' ? ' selected' : '') + '>Revisão</option>' +
      '</select></div>' +
      '<div><label for="reg-dur">Duração (min)</label><input id="reg-dur" type="number" min="1" max="720" value="' + (opcoes.duracaoMin || 30) + '"></div>' +
      '</div>' +
      '<div class="grade-2">' +
      '<div><label for="reg-feitas">Questões feitas</label><input id="reg-feitas" type="number" min="0" max="999" value="0"></div>' +
      '<div><label for="reg-certas">Acertos</label><input id="reg-certas" type="number" min="0" max="999" value="0"></div>' +
      '</div>' +
      '<div class="msg-erro oculto" id="reg-erro"></div>' +
      '<label for="reg-obs">Observação (opcional)</label><textarea id="reg-obs" placeholder="Ex.: travei em prazos de recurso"></textarea>' +
      '<label style="display:flex;align-items:center;gap:0.5rem;font-weight:400">' +
      '<input type="checkbox" id="reg-teoria-ok" style="width:auto;min-height:0"> Teoria finalizada neste tópico (agenda as revisões e recalcula o plano, tirando-o da fila de teoria)</label>' +
      '<div class="modal-acoes">' +
      '<button type="button" class="botao-quieto" id="reg-cancelar">Cancelar</button>' +
      '<button type="submit">Registrar sessão</button>' +
      '</div></form>'
    );

    const selDisc = m.querySelector('#reg-disc');
    const selTop = m.querySelector('#reg-topico');

    function preencherTopicos() {
      const d = D.disciplinaPorId(state, selDisc.value);
      selTop.innerHTML = d.topicos.map(function (t) {
        return '<option value="' + esc(t.id) + '"' + (t.id === topicoIni ? ' selected' : '') + '>' + esc(t.id + ' — ' + t.nome) + '</option>';
      }).join('');
    }
    preencherTopicos();
    selDisc.addEventListener('change', preencherTopicos);
    m.querySelector('#reg-cancelar').addEventListener('click', fecharModal);

    m.querySelector('#form-registro').addEventListener('submit', function (e) {
      e.preventDefault();
      const erroEl = m.querySelector('#reg-erro');
      const dur = parseInt(m.querySelector('#reg-dur').value, 10);
      const feitas = parseInt(m.querySelector('#reg-feitas').value, 10) || 0;
      const certas = parseInt(m.querySelector('#reg-certas').value, 10) || 0;

      if (!dur || dur < 1) { erroEl.textContent = 'Informe a duração em minutos (mínimo 1).'; erroEl.classList.remove('oculto'); return; }
      if (certas > feitas) { erroEl.textContent = 'Acertos (' + certas + ') não podem superar as questões feitas (' + feitas + ').'; erroEl.classList.remove('oculto'); return; }

      // A sessão é registrada na DATA do bloco (quando veio da agenda/calendário),
      // não sempre em "hoje" — registrar o bloco de sábado deve cair no sábado.
      const dataReg = opcoes.data || D.hojeISO();
      const dados = {
        topicoId: selTop.value,
        tipo: m.querySelector('#reg-tipo').value,
        duracaoMin: dur, qFeitas: feitas, qCertas: certas,
        obs: m.querySelector('#reg-obs').value.trim(),
        teoriaOk: m.querySelector('#reg-teoria-ok').checked,
        data: dataReg,
        blocoId: opcoes.blocoId || null
      };

      // caminho infeliz F1: registro duplicado no mesmo dia/tópico/tipo → confirmar.
      // Sessões que continuam um bloco da agenda (blocoId) são parciais por natureza
      // — não avisa duplicidade, senão cada parte do mesmo bloco pediria confirmação.
      const duplicada = state.sessoes.some(function (s) {
        return s.data === dataReg && s.topicoId === dados.topicoId && s.tipo === dados.tipo;
      });
      if (duplicada && !opcoes.confirmouDuplicada && !opcoes.blocoId) {
        const quando = dataReg === D.hojeISO() ? 'hoje' : 'em ' + D.formatarDataBR(dataReg);
        erroEl.innerHTML = 'Você já registrou <strong>' + esc(dados.tipo) + '</strong> deste tópico ' + quando + '. Clique em "Registrar sessão" de novo para confirmar como sessão adicional.';
        erroEl.classList.remove('oculto');
        opcoes.confirmouDuplicada = true;
        return;
      }

      fecharModal();
      concluirRegistro(dados);
      if (opcoes.aoSalvar) opcoes.aoSalvar();
    });
  }

  function concluirRegistro(dados) {
    const hoje = D.hojeISO();
    const data = dados.data || hoje; // data real do estudo (pode ser de outro dia)
    const metaAntes = D.metaSemanal(state, hoje);
    const streakAntes = D.streak(D.sessoesDoPlano(state), hoje);

    const sessao = {
      id: window.Store.novoId('ses'), planoId: state.planoAtivoId, data: data,
      topicoId: dados.topicoId, tipo: dados.tipo,
      duracaoMin: dados.duracaoMin, qFeitas: dados.qFeitas, qCertas: dados.qCertas,
      obs: dados.obs || '',
      origemRegistroRapido: dados.origemRegistroRapido || ''
    };
    state.sessoes.push(sessao);

    let marcouTeoria = false;
    const topico = D.topicoPorId(state, dados.topicoId);
    if (topico) {
      if (dados.teoriaOk && topico.status !== 'dominado') {
        marcouTeoria = topico.status !== 'teoria_concluida';
        topico.status = 'teoria_concluida';
        if (agendarRevisoesSeNecessario(dados.topicoId)) {
          toast('Revisões agendadas: 24h · 3d · 7d · 14d · 30d', 'sucesso');
        }
      } else if (topico.status === 'pendente') {
        topico.status = 'em_curso';
      }
      if (topico.reaberto && dados.qFeitas > 0 && !D.sugerirReestudo(dados.qFeitas, dados.qCertas)) {
        topico.reaberto = false; // desempenho recuperado tira o tópico da fila de reabertos
      }
    }

    // Bloco da agenda: credita o tempo no bloco correspondente e fecha-o só quando
    // o tempo somado alcança o planejado (antes disso o calendário mostra "faltam
    // X de Y"). Se o registro veio de um bloco específico (timer/registro do bloco)
    // usa-o; senão procura um bloco aberto do mesmo tópico na data — assim QUALQUER
    // timer (aba Timer, FAB, fila do Hoje) desconta do bloco do dia.
    if (!dados.semBloco) {
      let blocoCred = dados.blocoId;
      if (!blocoCred) { const bm = acharBlocoParaSessao(dados.topicoId, data, dados.tipo); if (bm) blocoCred = bm.id; }
      if (blocoCred) {
        const bl = creditarBlocoAgenda(blocoCred, dados.duracaoMin || 0);
        // Reflete no calendário o que foi REALMENTE estudado: se o aluno trocou o
        // tópico (ou a disciplina) no meio da sessão, atualiza o bloco creditado
        // para o estudo real — em vez de deixar o bloco antigo e criar um extra.
        if (bl && dados.tipo !== 'revisao' && dados.topicoId) {
          const discS = D.disciplinaDoTopico(state, dados.topicoId);
          if (discS && bl.disciplinaId !== discS.id) bl.disciplinaId = discS.id;
          if (bl.topicoId && bl.topicoId !== dados.topicoId) bl.topicoId = dados.topicoId;
        }
        if (bl && !dados.semRender) {
          if (bl.feito) toast('Bloco concluído ✓', 'sucesso');
          else toast('Faltam ' + D.formatarMin(blocoRestanteMin(bl)) + ' para fechar o bloco', 'sucesso');
        }
      } else if (topico && (dados.duracaoMin || 0) > 0) {
        // Estudo livre (Timer/registro avulso) num tópico SEM bloco planejado no
        // dia: cria um bloco "extra" já concluído, para o estudo aparecer sozinho
        // no calendário — sem a pessoa precisar arrastar um bloco e cronometrar.
        // É manual (gerado:false → sobrevive a recálculos) e marcado como extra,
        // fora da distribuição planejada do plano (não desconta do tempo do dia).
        const disc = D.disciplinaDoTopico(state, dados.topicoId);
        state.agenda.push({
          id: window.Store.novoId('agd'), planoId: state.planoAtivoId,
          data: data, disciplinaId: disc ? disc.id : null,
          topicoId: dados.topicoId, duracaoMin: dados.duracaoMin,
          obs: dados.tipo === 'teoria' ? 'teoria' : dados.tipo,
          feito: true, feitoMin: dados.duracaoMin,
          gerado: false, extra: true
        });
      }
    }

    // Ciclo de estudos: credita o tempo da sessão no bloco da matéria e avança a fila.
    const ciclo = D.cicloAtivo(state);
    if (ciclo) normalizarCicloAtivoPelaRotina();
    if (ciclo && topico) {
      const disc = D.disciplinaDoTopico(state, dados.topicoId);
      const av = D.avancarCiclo(ciclo, disc ? disc.id : null, dados.duracaoMin);
      if (av.completouVolta) {
        confete();
        toast('Volta do ciclo concluída! Recomeçando a fila 🔄', 'sucesso');
      } else if (av.completouBloco) {
        toast('Bloco do ciclo concluído — próxima matéria liberada ✓', 'sucesso');
      }
    }

    // Revisão adaptativa: as questões do estudo do dia a dia também reescalam as
    // próximas revisões pendentes do tópico (vai bem → espaça; vai mal → aproxima).
    let reagDiario = { ajustadas: 0, fator: 1 };
    if (dados.qFeitas > 0 && topico) {
      reagDiario = D.reagendarRevisoesAdaptativo(state.revisoes, dados.topicoId, hoje, D.sessoesDoPlano(state), topico.incidencia_pct);
    }

    salvar();
    toast('Sessão registrada', 'sucesso');
    if (reagDiario.ajustadas > 0 && reagDiario.fator < 0.95) {
      toast('Desempenho abaixo em ' + nomeTopicoCompleto(dados.topicoId) + ' — aproximei as próximas revisões deste tópico.', 'erro');
    } else if (reagDiario.ajustadas > 0 && reagDiario.fator > 1.05) {
      toast('Indo bem em ' + nomeTopicoCompleto(dados.topicoId) + ' — espacei as próximas revisões.', 'sucesso');
    }

    // Teoria concluída tira o tópico da fila de teoria e replaneja o restante
    // (caso do aluno avançado que já dominou parte do edital).
    if (marcouTeoria) {
      const r = recalcularPlanoAdaptativo(true);
      if (r) toast('Teoria concluída — plano recalculado; este tópico saiu da fila de teoria.', 'sucesso');
    }

    // RN07 — sugestão de reestudo (o usuário decide)
    const streakDepois = D.streak(D.sessoesDoPlano(state), hoje);
    const ganhouDia = streakDepois.atual > streakAntes.atual;
    if (ganhouDia && streakDepois.atual > streakAntes.recorde) {
      confete();
      toast('Novo recorde de constância: ' + streakDepois.atual + ' dias! 🏆', 'sucesso');
    } else if (ganhouDia && streakDepois.atual >= 7) {
      confete();
      toast('Sequência forte: ' + streakDepois.atual + ' dias de constância! 🎉', 'sucesso');
    }

    // 3 desempenhos seguidos abaixo de 65% → sinaliza que a base teórica precisa
    // de revisão (as questões não estão fixando). Sinal suave: não reabre sozinho.
    if (dados.qFeitas > 0 && D.sugereRevisarTeoria(state, dados.topicoId)) {
      toast('3 desempenhos seguidos abaixo de 65% em ' + nomeTopicoCompleto(dados.topicoId) + ' — vale revisar a teoria deste tópico.', 'erro');
    }

    if (D.sugerirReestudo(dados.qFeitas, dados.qCertas)) {
      const m = abrirModal(
        '<h3>Mais erros que acertos</h3>' +
        '<p>Você errou mais da metade das questões de <strong>' + esc(nomeTopicoCompleto(dados.topicoId)) + '</strong> (' +
        (dados.qFeitas - dados.qCertas) + ' de ' + dados.qFeitas + ').</p>' +
        '<p>Quer mandar o tópico de volta para a fila desta semana?</p>' +
        '<div class="modal-acoes">' +
        '<button type="button" class="botao-quieto" id="rn7-nao">Agora não</button>' +
        '<button type="button" id="rn7-sim">Mandar para a fila</button></div>'
      );
      m.querySelector('#rn7-nao').addEventListener('click', fecharModal);
      m.querySelector('#rn7-sim').addEventListener('click', function () {
        const t = D.topicoPorId(state, dados.topicoId);
        if (t) { t.reaberto = true; if (t.status === 'teoria_concluida') t.status = 'em_curso'; }
        salvar(); fecharModal(); render();
        toast('Tópico na fila da semana', 'sucesso');
      });
    }

    // micro-celebração: bateu a meta de horas da semana agora
    const metaDepois = D.metaSemanal(state, hoje);
    if (metaDepois.horasAlvo > 0 &&
        metaAntes.minutos < metaDepois.horasAlvo * 60 &&
        metaDepois.minutos >= metaDepois.horasAlvo * 60) {
      confete();
      toast('Meta semanal de horas batida! 🎯', 'sucesso');
    }
    // O registro rápido (bolinha) controla o próprio render para a animação do
    // check verde aparecer; nesse caso não redesenhamos aqui por cima dela.
    if (!dados.semRender) render();
    return sessao;
  }

  // ---------------- TELA: Hoje ----------------
  function mensagemCoach(pct, metaPct) {
    if (pct === null || pct === undefined) return 'Registra umas questões que eu te digo como você está.';
    if (pct >= metaPct) return 'Ritmo de aprovação — continua assim que a vaga é tua! 🚀';
    if (pct >= metaPct - 10) return 'Tá no caminho, guerreiro. Mantém o ritmo! 🔥';
    if (pct >= 50) return 'Base em construção — volta nos erros que esse número sobe.';
    return 'Precisa melhorar: revisa a teoria e refaz as questões erradas. Bora!';
  }

  function heatmapHtml(nDias, comResumo) {
    const hoje = D.hojeISO();
    // Constância = dias de estudo do PLANO ativo (igual às demais métricas). Sem
    // isso, sessões de outros planos (ex.: órfãs de um plano excluído) inflavam o
    // número aqui e divergiam da faixa/heatmap da tela de Desempenho.
    const ses = D.sessoesDoPlano(state);
    const dias = D.heatmapDias(ses, hoje, nDias);
    const st = D.streak(ses, hoje);
    const recordeAnterior = recordeAntesDeHoje(ses, hoje);
    const extras = emojisConstancia(st, recordeAnterior);
    let html = '<div class="heatmap-wrap">';
    if (comResumo) {
      html += '<div class="streak-resumo">' +
        (st.atual > 0
          ? 'Você está há <strong>' + st.atual + (st.atual === 1 ? ' dia seguido' : ' dias seguidos') + '</strong> estudando · recorde: ' + st.recorde
          : 'Nenhum estudo registrado hoje' + (st.recorde > 0 ? ' · recorde: ' + st.recorde + ' dias.' : '')) +
        '</div>';
    }
    if (comResumo && st.atual > 0 && extras) {
      html = html.replace('</strong> estudando ', '</strong> estudando' + extras + ' ');
    }
    html += '<div class="heatmap">' +
      dias.map(function (d) {
        const n = d.minutos === 0 ? 0 : d.minutos < 30 ? 1 : d.minutos < 60 ? 2 : d.minutos < 120 ? 3 : 4;
        return '<span class="heatmap-celula' + (n > 0 ? ' heatmap-n' + n : '') + '" title="' + D.formatarDataBR(d.data) + ' — ' + D.formatarMin(d.minutos) + '"></span>';
      }).join('') + '</div>';
    html += '<div class="heatmap-legenda">menos <span class="heatmap-celula"></span><span class="heatmap-celula heatmap-n1"></span><span class="heatmap-celula heatmap-n2"></span><span class="heatmap-celula heatmap-n3"></span><span class="heatmap-celula heatmap-n4"></span> mais</div>';
    html += '</div>';
    return html;
  }

  function constanciaFaixaHtml(nDias) {
    const hoje = D.hojeISO();
    const dias = D.heatmapDias(D.sessoesDoPlano(state), hoje, nDias || 30);
    const st = D.streak(D.sessoesDoPlano(state), hoje);
    const recordeAnterior = recordeAntesDeHoje(D.sessoesDoPlano(state), hoje);
    const extras = emojisConstancia(st, recordeAnterior);
    const inicio = dias.length ? dias[0].data : hoje;
    const fim = dias.length ? dias[dias.length - 1].data : hoje;
    return '<div class="constancia-faixa">' +
      '<div class="constancia-faixa-topo"><div><div class="card-kpi-rotulo">⚡ Constância nos estudos</div>' +
      '<p>Você está há <strong>' + st.atual + (st.atual === 1 ? ' dia' : ' dias') + '</strong> sem falhar! Seu recorde é de <strong>' + st.recorde + (st.recorde === 1 ? ' dia' : ' dias') + '</strong>.</p></div>' +
      '<div class="constancia-periodo"><button class="botao-mini botao-quieto" type="button" disabled>‹</button><span>' + D.formatarDataBR(inicio).slice(0, 5) + ' ~ ' + D.formatarDataBR(fim).slice(0, 5) + '</span><button class="botao-mini botao-quieto" type="button" disabled>›</button></div></div>' +
      '<div class="constancia-trilho">' + dias.map(function (d) {
        const fez = d.minutos > 0;
        const folga = !fez && diaFolgaRotina(d.data);
        const classe = fez ? 'feito' : (folga ? 'folga' : 'falha');
        const simbolo = fez ? '✓' : (folga ? '•' : '×');
        const titulo = D.formatarDataBR(d.data) + ' — ' + (folga ? 'folga planejada' : D.formatarMin(d.minutos));
        return '<span class="constancia-dia constancia-' + classe + '" aria-label="' + esc(titulo) + '">' + simbolo + '</span>';
      }).join('') + '</div></div>';
  }

  function diaFolgaRotina(dataISO) {
    const partes = String(dataISO || '').split('-').map(Number);
    if (partes.length < 3) return false;
    const chave = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'][new Date(partes[0], partes[1] - 1, partes[2]).getDay()];
    const rotina = rotinaEstudosAtual();
    return !!(rotina && rotina.dias && rotina.dias[chave] && !rotina.dias[chave].ativo);
  }

  function dadosPainelDisciplinas() {
    return state.disciplinas.filter(function (d) { return d.id !== 'ORF'; }).map(function (d) {
      const ids = new Set(d.topicos.map(function (t) { return t.id; }));
      let minutos = 0, feitas = 0, certas = 0;
      D.sessoesDoPlano(state).forEach(function (s) {
        if (!ids.has(s.topicoId)) return;
        minutos += s.duracaoMin || 0;
        feitas += s.qFeitas || 0;
        certas += s.qCertas || 0;
      });
      const progresso = D.progressoDisciplina(d);
      const pct = feitas > 0 ? Math.round((certas / feitas) * 100) : null;
      return {
        id: d.id,
        nome: d.nome,
        cor: d.cor,
        minutos: minutos,
        tempo: minutos > 0 ? D.formatarMin(minutos) : '-',
        certas: certas,
        erros: Math.max(0, feitas - certas),
        feitas: feitas,
        pct: pct,
        progresso: progresso.pct
      };
    }).sort(function (a, b) {
      return b.minutos - a.minutos || b.feitas - a.feitas || a.nome.localeCompare(b.nome);
    });
  }

  // Limite inicial do painel de disciplinas: 4 no mobile, 7 no desktop. O resto
  // fica atrás do "Ver mais". Estado guardado fora do DOM para sobreviver a
  // re-renders (sync, conquistas etc.).
  const PAINEL_DISC_LIMITE_MOBILE = 4;
  const PAINEL_DISC_LIMITE_DESKTOP = 7;
  let painelDiscExpandido = false;
  let hojeMetaConcluida = false; // calculado em telaHoje; usado pelo modal de parabéns

  // Traz a próxima matéria agendada (de um dia futuro) para HOJE, para quem quer
  // adiantar num dia livre. Move o item da agenda para a data de hoje.
  function adiantarProximaMateria() {
    const hoje = D.hojeISO();
    const futuras = doAtivo(state.agenda)
      .filter(function (a) { return a.data > hoje && !a.feito; })
      .sort(function (a, b) { return a.data.localeCompare(b.data) || compararAgenda(a, b); });
    if (!futuras.length) { toast('Não há próxima matéria agendada para adiantar.', 'erro'); return; }
    futuras[0].data = hoje;
    salvar(); render();
    toast('Próxima matéria trazida para hoje 👊', 'sucesso');
  }

  // Meta do dia concluída — cálculo INDEPENDENTE da tela renderizada (antes só
  // era avaliado dentro de telaHoje, então concluir um bloco no calendário não
  // disparava o parabéns até abrir a aba Hoje). Tinha o que estudar hoje (agenda
  // do dia), está tudo feito e não há revisões vencidas.
  function metaDoDiaConcluida() {
    if (!state.plano) return false;
    const hoje = D.hojeISO();
    const agendaHoje = doAtivo(state.agenda).filter(function (a) { return a.data === hoje; });
    if (agendaHoje.length === 0) return false;
    if (!agendaHoje.every(function (a) { return blocoAgendaConcluido(a); })) return false;
    return D.filaHoje(state, hoje).filter(function (i) { return i.categoria === 'revisao'; }).length === 0;
  }

  // Modal central de parabéns quando a meta do dia é concluída (1x por dia).
  function talvezComemorarDia() {
    if (!metaDoDiaConcluida()) return;
    const hoje = D.hojeISO();
    if (state.config && state.config.metaDiaEm === hoje) return; // já comemorou hoje
    state.config.metaDiaEm = hoje;
    salvar();
    if (typeof confete === 'function') confete();
    const m = abrirModal(
      '<div class="meta-dia-modal" style="text-align:center">' +
      '<div style="font-size:2.6rem;line-height:1">🎉</div>' +
      '<h3 style="margin:0.4rem 0">Meta do dia concluída!</h3>' +
      '<p class="sub">Você fechou tudo que estava planejado para hoje. É essa constância que te leva preparado até a prova — descansa que amanhã tem mais. 💪</p>' +
      '<div class="modal-acoes" style="justify-content:center"><button id="meta-dia-ok">Boa! 🙌</button></div></div>'
    );
    m.querySelector('#meta-dia-ok').addEventListener('click', fecharModal);
  }

  function painelDiscLimite() {
    return (window.matchMedia && window.matchMedia('(max-width: 760px)').matches)
      ? PAINEL_DISC_LIMITE_MOBILE : PAINEL_DISC_LIMITE_DESKTOP;
  }
  // Paleta de chips no Planejamento: 1 linha (5) no mobile, resto atrás do "+N".
  const PALETA_LIMITE_MOBILE = 5;

  function painelDisciplinasHojeHtml() {
    const linhas = dadosPainelDisciplinas();
    if (linhas.length === 0) return '';
    // Limite conforme a tela atual (4 mobile / 7 desktop). Mostra todos quando
    // expandido. O botão só aparece quando há excedente para a tela atual.
    const limite = painelDiscLimite();
    const temExcedente = linhas.length > limite;
    if (!temExcedente) painelDiscExpandido = false;
    const visiveis = (painelDiscExpandido || !temExcedente) ? linhas : linhas.slice(0, limite);
    const ocultas = Math.max(0, linhas.length - limite);
    const verMaisTxt = painelDiscExpandido ? 'Ver menos' : ('Ver mais ' + ocultas + ' disciplina' + (ocultas > 1 ? 's' : ''));
    const botaoVerMais = temExcedente
      ? '<button type="button" class="painel-disc-vermais botao-mini botao-quieto" data-painel-vermais aria-expanded="' + (painelDiscExpandido ? 'true' : 'false') + '">' + verMaisTxt + '</button>'
      : '';
    return '<div class="card painel-disciplinas-card"><h3 class="painel-titulo">Painel de disciplinas</h3>' +
      '<div class="painel-disciplinas-mobile">' + visiveis.map(function (d) {
        return '<button type="button" class="painel-disc-mobile" data-disc-detalhe="' + esc(d.id) + '" style="--disc-cor:' + esc(d.cor) + '">' +
          '<span class="painel-disc-mobile-nome">' + esc(nomeDiscCurto(d.nome)) + '</span>' +
          pizzaAcertosHtml(d.certas, d.erros, { classe: 'pizza-sm', titulo: d.nome }) +
          '</button>';
      }).join('') + '</div>' +
      '<div class="painel-scroll"><table class="painel-disciplinas"><thead><tr>' +
      '<th>Matéria</th><th class="num">Tempo</th><th class="num">✓</th><th class="num">×</th><th class="num">Questões</th><th class="num">%</th></tr></thead><tbody>' +
      visiveis.map(function (d) {
        const pctClasse = d.pct === null ? 'neutro' : d.pct >= 70 ? 'bom' : d.pct >= 60 ? 'medio' : 'baixo';
        return '<tr data-disc-detalhe="' + esc(d.id) + '" role="button" tabindex="0">' +
          '<td><span class="disc-link" style="--disc-cor:' + esc(d.cor) + '">' + esc(nomeDiscCurto(d.nome)) + '</span></td>' +
          '<td class="num">' + d.tempo + '</td>' +
          '<td class="num painel-acertos">' + d.certas + '</td>' +
          '<td class="num painel-erros">' + d.erros + '</td>' +
          '<td class="num">' + d.feitas + '</td>' +
          '<td class="num"><span class="painel-pct painel-pct-' + pctClasse + '">' + (d.pct === null ? '0' : d.pct) + '</span></td>' +
          '</tr>';
      }).join('') +
      '</tbody></table></div>' +
      botaoVerMais +
      '</div>';
  }

  // Banner do modo reta final: aparece nas últimas semanas antes da prova com
  // foco em consolidar (questões, simulados, revisão do que mais cai e dos pontos
  // fracos). Vazio quando não há prova marcada ou ainda está longe.
  function retaFinalBannerHtml(hoje) {
    if (!state.plano) return '';
    const rf = D.retaFinalInfo(state, hoje);
    if (!rf.ativa) return '';
    const pr = D.prontidaoProva(state, hoje);
    const fracos = D.pioresTopicos(state, 3);
    // título: o countdown só aparece quando a prova está perto de verdade (porData);
    // se foi ligado manualmente (data longe ou sem data), foco direto, sem contagem.
    const titulo = rf.porData
      ? 'Reta final — falta ' + (rf.semanas <= 1 ? 'menos de 1 semana' : 'cerca de ' + rf.semanas + ' semanas')
      : 'Reta final — foco total em consolidar';
    let foco = '';
    if (fracos.length) {
      foco = '<div class="reta-final-fracos"><span class="reta-final-foco-rotulo">Treine questões dos seus pontos fracos:</span>' +
        fracos.map(function (f) {
          return '<button type="button" class="botao-mini reta-final-chip" data-acao="registrar" data-id="' + esc(f.topico.id) + '" data-tipo="questoes" title="Registrar questões de ' + esc(f.topico.nome) + '">' +
            esc(nomeDiscCurto(f.disciplina.nome)) + ' · ' + esc(f.topico.nome) + ' (' + f.pct + '%)</button>';
        }).join('') + '</div>';
    } else {
      foco = '<p class="reta-final-foco-rotulo">Priorize <strong>questões dos tópicos de maior incidência</strong> e simulados — é o que mais rende agora.</p>';
    }
    return '<div class="card reta-final-card">' +
      '<div class="reta-final-cab"><span class="reta-final-emoji" aria-hidden="true">🏁</span>' +
      '<div><h3>' + esc(titulo) + '</h3>' +
      '<p class="sub">Hora de <strong>consolidar</strong>: menos teoria nova, mais questões, simulados e revisão do que mais cai.' +
      (pr ? ' Você está com <strong>' + pr.pct + '%</strong> dos tópicos revisados a tempo.' : '') + '</p></div></div>' +
      foco +
      '<div class="reta-final-acoes">' +
      '<a class="botao-mini" href="#simulados">Fazer um simulado</a>' +
      '<a class="botao-mini botao-quieto" href="#revisoes">Revisar o que vence</a></div>' +
      '</div>';
  }

  // Banner do modo aprofundamento (Hoje). Aparece quando o aluno ativou o modo e
  // a prova NÃO está na reta final (a reta final tem prioridade e foco oposto).
  function aprofundamentoBannerHtml(hoje) {
    if (!state.plano || !state.plano.modoAprofundamento) return '';
    if (D.retaFinalInfo(state, hoje).ativa) return ''; // reta final assume
    const prog = D.progressoEdital(state);
    // tópicos de maior incidência ainda não dominados → onde aprofundar
    const alvos = [];
    state.disciplinas.forEach(function (d) {
      if (d.id === 'ORF') return;
      (d.topicos || []).forEach(function (t) {
        if (t.orfao || t.status === 'dominado') return;
        alvos.push({ t: t, d: d, inc: t.incidencia_pct || 0 });
      });
    });
    alvos.sort(function (a, b) { return b.inc - a.inc; });
    const chips = alvos.slice(0, 3).filter(function (x) { return x.inc > 0; }).map(function (x) {
      return '<button type="button" class="botao-mini reta-final-chip" data-acao="registrar" data-id="' + esc(x.t.id) + '" data-tipo="questoes" title="Aprofundar ' + esc(x.t.nome) + ' com questões">' +
        esc(nomeDiscCurto(x.d.nome)) + ' · ' + esc(x.t.nome) + (x.inc ? ' (' + x.inc + '%)' : '') + '</button>';
    }).join('');
    return '<div class="card aprof-card">' +
      '<div class="reta-final-cab"><span class="reta-final-emoji" aria-hidden="true">🎓</span>' +
      '<div><h3>Modo aprofundamento</h3>' +
      '<p class="sub">Sem pressa de relógio: foque em <strong>cobrir o edital</strong> e <strong>reter</strong>. Já são <strong>' + prog.pct + '%</strong> de cobertura — depois de cobrir, aprofunde o que mais cai.</p></div></div>' +
      (chips ? '<span class="reta-final-foco-rotulo">Aprofunde a alta incidência com questões:</span><div class="reta-final-fracos">' + chips + '</div>' : '') +
      '<div class="reta-final-acoes">' +
      '<a class="botao-mini" href="#revisoes">Revisar e fixar</a>' +
      '<a class="botao-mini botao-quieto" href="#simulados">Treinar com simulado</a></div>' +
      '</div>';
  }

  function telaHoje() {
    const hoje = D.hojeISO();
    const hora = new Date().getHours();
    const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
    const frase = window.Frases.fraseDoDia();
    // garante que a agenda do dia esteja preenchida a partir do cronograma —
    // só PREENCHE semanas vazias (soVazias) para não apagar o progresso já marcado
    if (state.plano) { if (sincronizarAgendaComCronograma(true) > 0) salvar(); }
    const agendaHoje = doAtivo(state.agenda).filter(function (a) { return a.data === hoje; });
    // Fila por urgência (80/20 dinâmico): hoje ataca primeiro o que mais rende —
    // incidência × déficit de desempenho × proximidade da prova. Itens já feitos
    // afundam. Cache local por id (não muta o estado, que seria persistido).
    const urgCache = {};
    function urgDe(a) {
      if (!a || !a.topicoId) return 0;
      if (urgCache[a.id] == null) urgCache[a.id] = D.urgenciaTopico(state, a.topicoId, hoje);
      return urgCache[a.id];
    }
    agendaHoje.sort(function (a, b) {
      if (!!a.feito !== !!b.feito) return a.feito ? 1 : -1;
      return urgDe(b) - urgDe(a);
    });
    // Destaca o ÚNICO item mais urgente do dia (se o sinal for relevante).
    let topUrgenteId = null, topUrgenteScore = 0;
    agendaHoje.forEach(function (a) {
      if (a.feito) return;
      const u = urgDe(a);
      if (u > topUrgenteScore) { topUrgenteScore = u; topUrgenteId = a.id; }
    });
    const mostrarFogo = topUrgenteScore >= 1.2;

    if (!state.plano && state.disciplinas.length === 0 && agendaHoje.length === 0 && state.sessoes.length === 0) {
      return '<div class="cab-pagina"><div><h1>' + saudacaoCompleta(saudacao) + '</h1></div></div>' +
        '<div class="frase-dia">“' + esc(frase.t) + '”' + (frase.a ? '<span class="autor">— ' + esc(frase.a) + '</span>' : '') + '</div>' +
        linksApoioHojeHtml() +
        '<div class="card"><div class="estado-vazio">' +
        '<span class="bolha bolha-pendente"></span>' +
        '<strong>Bora montar seu plano?</strong>' +
        'Escolha seu concurso e o sistema gera o cronograma, as revisões e a fila do dia automaticamente.' +
        '<p style="margin-top:1rem"><a class="botao" href="#planos">📚 Escolher meu concurso</a></p>' +
        '<p style="margin-top:0.5rem"><a class="botao-quieto" href="#planejamento" style="font-size:0.85rem">ou montar um plano manualmente</a></p>' +
        '</div></div>';
    }

    const fila = D.filaHoje(state, hoje);
    const meta = D.metaSemanal(state, hoje);
    const ciclo = D.cicloAtivo(state);
    const sem = (state.plano && !ciclo) ? D.semanaCorrente(state, hoje) : null;

    // agenda manual do dia entra na fila logo após as revisões
    const itensAgenda = agendaHoje.map(function (a) { return { categoria: 'agenda', agenda: a }; });
    let posInsercao = 0;
    while (posInsercao < fila.length && fila[posInsercao].categoria === 'revisao') posInsercao++;
    fila.splice.apply(fila, [posInsercao, 0].concat(itensAgenda));

    // Hoje foca no DIA: o conteúdo do cronograma para hoje vem da AGENDA (que é
    // preenchida por dia); os blocos da semana inteira saem da fila do Hoje.
    for (let k = fila.length - 1; k >= 0; k--) { if (fila[k].categoria === 'bloco') fila.splice(k, 1); }

    // Modo ciclo: troca os blocos do cronograma pela fila do ciclo (bloco atual
    // + próximos), logo após as revisões vencidas.
    if (ciclo) {
      for (let k = fila.length - 1; k >= 0; k--) { if (fila[k].categoria === 'bloco') fila.splice(k, 1); }
      // Só as disciplinas já ATIVAS (introdução gradual): o que entra em voltas
      // futuras não aparece na fila do dia.
      const blocos = D.blocosAtivosCiclo(ciclo);
      const idxAtual = blocos.findIndex(function (b) { return (b.feitoMin || 0) < (b.metaMin || 0); });
      const cicloItens = [];
      if (idxAtual >= 0) {
        for (let k = idxAtual; k < blocos.length && cicloItens.length < 3; k++) {
          const b = blocos[k];
          if ((b.feitoMin || 0) < (b.metaMin || 0)) cicloItens.push({ categoria: 'ciclo', bloco: b, atual: k === idxAtual });
        }
      }
      let pos = 0;
      while (pos < fila.length && fila[pos].categoria === 'revisao') pos++;
      fila.splice.apply(fila, [pos, 0].concat(cicloItens));
    }

    // Os blocos da semana seguem a MESMA ordem do calendário do Planejamento
    // (dia a dia, seg→dom, e dentro do dia a ordem dos blocos), para a lista de
    // Hoje não divergir do calendário e confundir o aluno.
    if (sem && sem.inicio) {
      const tipoChave = function (t) { return t === 'teoria' ? 'teoria' : 'questoes'; };
      const rank = {}; let r = 0;
      for (let dd = 0; dd < 7; dd++) {
        blocosDoDia(D.addDias(sem.inicio, dd)).forEach(function (a) {
          const chave = (a.topicoId || '') + '|' + tipoChave(a.obs);
          if (rank[chave] === undefined) rank[chave] = r++;
        });
      }
      const blocoItens = [], posicoes = [];
      fila.forEach(function (it, idx) { if (it.categoria === 'bloco') { blocoItens.push(it); posicoes.push(idx); } });
      blocoItens.sort(function (x, y) {
        const rx = rank[x.topicoId + '|' + tipoChave(x.tipoBloco)];
        const ry = rank[y.topicoId + '|' + tipoChave(y.tipoBloco)];
        return (rx === undefined ? 1e9 : rx) - (ry === undefined ? 1e9 : ry);
      });
      posicoes.forEach(function (p, k) { fila[p] = blocoItens[k]; });
    }

    const nRev = fila.filter(function (i) { return i.categoria === 'revisao'; }).length;
    const nCiclo = fila.filter(function (i) { return i.categoria === 'ciclo'; }).length;
    const nBlocos = fila.filter(function (i) { return (i.categoria === 'bloco' && !i.feito) || (i.categoria === 'agenda' && !blocoAgendaConcluido(i.agenda)); }).length + nCiclo;
    const pendentes = nRev + nBlocos + fila.filter(function (i) { return i.categoria === 'reaberto'; }).length;
    // "Meta do dia" concluída: tinha o que estudar hoje (agenda do dia) e está tudo
    // feito, sem revisões vencidas. Usado para o modal de parabéns (1x/dia).
    hojeMetaConcluida = !!(state.plano && agendaHoje.length > 0 &&
      agendaHoje.every(function (a) { return a.feito; }) && nRev === 0);
    const resumoDia = pendentes === 0 ? 'Tudo em dia por hoje.' :
      nBlocos + (nBlocos === 1 ? ' bloco' : ' blocos') + ' e ' + nRev + (nRev === 1 ? ' revisão te esperam' : ' revisões te esperam') + '.';

    // Card "Data provável" agora é independente do "Mantenha a constância".
    // Desktop: aparece no topo, alinhado à saudação. Mobile: card próprio logo
    // acima do mapa de constância (mantém a posição atual). Renderizamos as duas
    // variantes e o CSS mostra a adequada a cada tela.
    const provaCard = state.plano ? '<div class="card prova-card prova-card-solo">' + provaEstimadaConteudoHtml() + '</div>' : '';
    const fraseHtml = '<div class="frase-dia">“' + esc(frase.t) + '”' + (frase.a ? '<span class="autor">— ' + esc(frase.a) + '</span>' : '') + '</div>';

    // Coluna esquerda (saudação + frase do dia) ao lado do card de data provável.
    // No desktop a frase sobe para preencher o vão do meio; no mobile tudo empilha.
    let html = '<div class="home-cab">' +
      '<div class="home-cab-esq">' +
      '<div class="cab-pagina cab-home"><div><span class="rotulo-pagina">' + D.formatarDataBR(hoje) + '</span><h1>' + saudacaoCompleta(saudacao) + '</h1>' +
      '<p class="sub">' + resumoDia + '</p></div></div>' +
      fraseHtml +
      '</div>' +
      (provaCard ? '<div class="home-cab-prova">' + provaCard + '</div>' : '') +
      '</div>';

    html += linksApoioHojeHtml();

    // Modo reta final: nas últimas semanas, banner de foco em consolidação.
    html += retaFinalBannerHtml(hoje);
    // Modo aprofundamento (manual): foco em cobertura + retenção quando há tempo.
    html += aprofundamentoBannerHtml(hoje);

    // versão mobile do card de data provável (acima do mapa de constância)
    if (provaCard) html += '<div class="prova-card-mobile">' + provaCard + '</div>';

    // constância em destaque (apenas o mapa)
    html += '<div class="card constancia-card"><div class="constancia-centro"><h3>⚡ Mantenha a constância!</h3>' + heatmapHtml(119, true) + '</div></div>';

    // conquistas (gamificação discreta)
    html += conquistasHtml();

    // cards: horas + questões + desempenho com mensagem
    html += '<div class="linha-cards home-kpis">';
    const pctHoras = meta.horasAlvo > 0 ? Math.min(100, Math.round((meta.minutos / 60 / meta.horasAlvo) * 100)) : 0;
    html += '<div class="card card-kpi"><div class="card-kpi-rotulo">Horas na semana</div>' +
      '<div class="card-kpi-valor card-kpi-valor-compacto">' + D.formatarMin(meta.minutos) + (meta.horasAlvo > 0 ? '<span style="font-size:0.85rem;color:var(--grafite)"> / ' + meta.horasAlvo + 'h</span>' : '') + '</div>' +
      (meta.horasAlvo > 0 ? '<div class="barra' + (pctHoras >= 100 ? ' barra-verde' : '') + '" style="margin-top:0.4rem"><span style="width:' + pctHoras + '%"></span></div>' :
        '<div class="card-kpi-extra">defina um plano para ter meta semanal</div>') + '</div>';
    const pctQ = meta.questoesAlvo > 0 ? Math.min(100, Math.round((meta.qFeitas / meta.questoesAlvo) * 100)) : 0;
    html += '<div class="card card-kpi"><div class="card-kpi-rotulo">Questões na semana</div>' +
      '<div class="card-kpi-valor card-kpi-valor-compacto">' + meta.qFeitas +
      '<button type="button" class="meta-q-editar" data-editar-meta title="Ajustar a meta semanal de questões"> / ' + meta.questoesAlvo + ' <span aria-hidden="true">✎</span></button></div>' +
      '<div class="barra' + (pctQ >= 100 ? ' barra-verde' : '') + '" style="margin-top:0.4rem"><span style="width:' + pctQ + '%"></span></div></div>';
    const metaPct = state.plano && state.plano.meta ? state.plano.meta.corte_pct : 70;
    const pctSemana = meta.qFeitas > 0 ? Math.round((meta.qCertas / meta.qFeitas) * 100) : D.desempenhoGeral(state);
    html += '<div class="card card-kpi"><div class="card-kpi-rotulo">Margem de acertos' + (meta.qFeitas > 0 ? ' na semana' : '') + '</div>' +
      '<div class="card-kpi-valor card-kpi-valor-compacto">' + (pctSemana === null ? '—' : pctSemana + '%') + '</div>' +
      '<div class="msg-coach">' + mensagemCoach(pctSemana, metaPct) + '</div></div>';
    html += '</div>';

    html += painelDisciplinasHojeHtml();

    // Renderiza um item da fila do dia. Extraído do loop único para ser
    // compartilhado pelos dois cards do Hoje (Revisões e Estudo).
    function itemHtmlFila(item) {
      if (item.categoria === 'ciclo') {
        const b = item.bloco;
        const dC = D.disciplinaPorId(state, b.disciplinaId);
        const tC = b.topicoId ? D.topicoPorId(state, b.topicoId) : null;
        const feito = Math.min(b.feitoMin || 0, b.metaMin || 0);
        const pct = b.metaMin > 0 ? Math.round((feito / b.metaMin) * 100) : 0;
        const restante = Math.max(0, (b.metaMin || 0) - feito);
        const tituloC = (dC ? tagDisc(dC) + ' ' : '') + esc(tC ? tC.nome : (dC ? dC.nome : b.disciplinaId));
        const dataReg = 'data-disc="' + esc(b.disciplinaId) + '"' + (b.topicoId ? ' data-id="' + esc(b.topicoId) + '"' : '') + ' data-dur="' + restante + '"';
        return '<div class="fila-item fila-checklist' + (item.atual ? ' fila-ciclo-atual' : '') + '">' +
          '<span class="fila-ciclo-marca" aria-hidden="true">' + (item.atual ? '▶' : '○') + '</span>' +
          '<div class="fila-corpo">' +
          '<div class="fila-info"><div class="fila-titulo">' + tituloC + '</div>' +
          '<div class="fila-sub">' + D.formatarMin(feito) + ' / ' + D.formatarMin(b.metaMin || 0) +
          '<span class="fila-ciclo-barra"><span style="width:' + pct + '%;background:' + esc(dC ? dC.cor : '#9A9DA3') + '"></span></span></div></div>' +
          '<div class="fila-rodape">' +
          '<span class="etiqueta etiqueta-bloco">' + (item.atual ? 'Ciclo · agora' : 'Ciclo') + '</span>' +
          '<div class="fila-acoes">' +
          '<button class="botao-mini botao-quieto" data-acao="ciclo-timer" ' + dataReg + '>Timer</button>' +
          '<button class="botao-mini" data-acao="ciclo-registrar" ' + dataReg + '>Estudar</button>' +
          '</div></div></div></div>';
      }
      if (item.categoria === 'agenda') {
        const a = item.agenda;
        const dA = D.disciplinaPorId(state, a.disciplinaId);
        const tA = a.topicoId ? D.topicoPorId(state, a.topicoId) : null;
        const tituloATexto = tA ? tA.nome : (dA ? dA.nome : a.disciplinaId);
        const tituloA = (dA ? tagDisc(dA) + ' ' : '') + esc(tituloATexto);
        // "Feito" no Hoje segue a MESMA regra do calendário (blocoAgendaConcluido):
        // conclusão por status do tópico ou por tempo estudado também conta — sem
        // isso o Hoje mostrava "Registrar" num bloco já concluído e um novo registro
        // duplicava a sessão do dia.
        const feitoA = blocoAgendaConcluido(a);
        return '<div class="fila-item fila-checklist' + (feitoA ? ' fila-feita' : '') + '">' +
          checkEstudoHtml(feitoA, 'concluir-agenda', a.id, null, tituloATexto) +
          '<div class="fila-corpo">' +
          '<div class="fila-info"><div class="fila-titulo">' + tituloA + '</div></div>' +
          '<div class="fila-rodape">' +
          (feitoA ? '<span class="etiqueta etiqueta-feito">Feito ✓</span>' :
            (mostrarFogo && a.id === topUrgenteId ? '<span class="etiqueta etiqueta-alerta" title="Prioridade do dia: mais alta incidência × desempenho abaixo da meta (e/ou prova próxima). Ataque este primeiro.">🔥 prioridade</span>' : '') +
            '<span class="etiqueta etiqueta-agenda">Agenda</span>' +
            (blocoParcial(a) ? '<span class="etiqueta etiqueta-parcial" title="Você já estudou parte deste bloco.">faltam ' + D.formatarMin(blocoRestanteMin(a)) + '</span>' : '') +
            '<div class="fila-acoes">' +
            '<button class="botao-mini botao-quieto" data-acao="timer-agenda" data-id="' + esc(a.id) + '">Timer</button>' +
            '<button class="botao-mini" data-acao="concluir-agenda" data-id="' + esc(a.id) + '">Registrar</button></div>') +
          '</div></div></div>';
      }
      const t = D.topicoPorId(state, item.topicoId);
      const d = D.disciplinaDoTopico(state, item.topicoId);
      let etiqueta, sub, acoes;
      if (item.categoria === 'revisao') {
        const atraso = D.diffDias(item.revisao.dataAgendada, hoje);
        etiqueta = '<span class="etiqueta etiqueta-revisao">Revisão ' + esc(item.revisao.tipo) + '</span>' + badgeAdaptacaoRevisao(item.revisao);
        sub = atraso > 0 ? 'vencida há ' + atraso + (atraso === 1 ? ' dia' : ' dias') : 'vence hoje';
        acoes = '<button class="botao-mini botao-quieto" data-acao="timer-revisao" data-id="' + esc(item.revisao.id) + '">Timer</button>' +
          '<button class="botao-mini" data-acao="concluir-revisao" data-id="' + esc(item.revisao.id) + '">Concluir</button>';
      } else if (item.categoria === 'bloco') {
        etiqueta = item.feito
          ? '<span class="etiqueta etiqueta-feito">Feito ✓</span>'
          : '<span class="etiqueta etiqueta-bloco">' + (item.tipoBloco === 'teoria' ? 'Teoria' : 'Questões') + '</span>';
        sub = 'bloco da semana ' + item.semana;
        acoes = item.feito ? '' :
          '<button class="botao-mini botao-quieto" data-acao="estudar" data-id="' + esc(item.topicoId) + '">Timer</button>' +
          '<button class="botao-mini" data-acao="registrar" data-id="' + esc(item.topicoId) + '" data-tipo="' + esc(item.tipoBloco) + '">Registrar</button>';
      } else {
        etiqueta = '<span class="etiqueta etiqueta-reaberto">Reaberto</span>';
        sub = 'voltou para a fila (desempenho baixo)';
        acoes = '<button class="botao-mini botao-quieto" data-acao="estudar" data-id="' + esc(item.topicoId) + '">Timer</button>' +
          '<button class="botao-mini" data-acao="registrar" data-id="' + esc(item.topicoId) + '" data-tipo="questoes">Registrar</button>';
      }
      const tituloTopico = t ? t.nome : item.topicoId;
      // 3 desempenhos seguidos abaixo de 65% → sugere revisar a base teórica.
      const avisoTeoria = D.sugereRevisarTeoria(state, item.topicoId)
        ? '<span class="etiqueta etiqueta-reaberto" title="3 desempenhos seguidos abaixo de 65% — as questões não estão fixando, vale revisar a teoria">↩ Revisar teoria</span>'
        : '';
      const check = item.categoria === 'revisao'
        ? checkEstudoHtml(false, 'concluir-revisao', item.revisao.id, null, tituloTopico)
        : checkEstudoHtml(!!item.feito, 'registrar', item.topicoId, item.categoria === 'reaberto' ? 'questoes' : item.tipoBloco, tituloTopico);
      return '<div class="fila-item fila-checklist' + (item.feito ? ' fila-feita' : '') + '">' +
        check +
        '<div class="fila-corpo">' +
        '<div class="fila-info"><div class="fila-titulo">' + (d ? tagDisc(d) + ' ' : '') + esc(tituloTopico) + '</div>' +
        '<div class="fila-sub">' + sub + '</div></div>' +
        '<div class="fila-rodape">' + etiqueta + avisoTeoria +
        '<div class="fila-acoes">' + acoes + '</div></div>' +
        '</div></div>';
    }

    // Particiona a fila: revisões ganham um card próprio (no topo, mantêm a
    // prioridade); blocos/agenda/ciclo/reaberto ficam no card "O que estudar hoje".
    const filaRev = fila.filter(function (i) { return i.categoria === 'revisao'; });
    const filaEstudo = fila.filter(function (i) { return i.categoria !== 'revisao'; });

    // Card de Revisões — só aparece quando há revisões vencidas/para hoje.
    if (filaRev.length) {
      const vencidas = filaRev.filter(function (i) { return D.diffDias(i.revisao.dataAgendada, hoje) > 0; }).length;
      const minRev = filaRev.reduce(function (n, i) { return n + D.duracaoRevisaoMin(i.revisao.tipo); }, 0);
      html += '<div class="card revisoes-hoje-card"><h3 style="margin-bottom:0.25rem">🔁 Revisões de hoje</h3>' +
        '<p class="sub" style="color:var(--grafite);font-size:0.85rem">' +
        filaRev.length + (filaRev.length === 1 ? ' revisão' : ' revisões') +
        (vencidas ? ' · ' + vencidas + (vencidas === 1 ? ' vencida' : ' vencidas') : '') +
        ' · ~' + D.formatarMin(minRev) + ' · <a href="#revisoes">ver todas</a></p>';
      filaRev.forEach(function (item) { html += itemHtmlFila(item); });
      html += '</div>';
    }

    // Card do estudo do dia (RN06 + agenda manual) — sem as revisões.
    html += '<div class="card estudar-hoje-card"><h3 style="margin-bottom:0.25rem">O que estudar hoje? 🤔</h3>';
    if (ciclo) {
      const temBlocos = (ciclo.blocos || []).length > 0;
      html += '<p class="sub" style="color:var(--grafite);font-size:0.85rem">🔄 Ciclo de estudos · Volta ' + (ciclo.volta || 1) +
        (temBlocos ? ' — siga a fila no seu ritmo' : '') +
        ' · <a href="#planejamento">editar ciclo</a></p>';
    } else if (sem && sem.futura) {
      html += '<p class="sub" style="color:var(--grafite);font-size:0.85rem">O cronograma começa em ' + D.formatarDataBR(sem.proxima.inicio) + ' (semana 1). Revisões e tópicos reabertos já aparecem aqui.</p>';
    } else if (sem && sem.encerrado) {
      html += '<div class="fim-cronograma"><p class="sub" style="margin:0 0 0.5rem">🏁 Você chegou ao fim do cronograma planejado! Gere uma nova fase para seguir até a prova, ou continue pelas revisões e simulados.</p>' +
        '<div class="compact-actions"><button class="botao-mini" id="hoje-nova-fase">Gerar nova fase</button>' +
        '<a class="botao-mini botao-quieto" href="#revisoes">Ir para revisões</a></div></div>';
    } else if (sem) {
      html += '<p class="sub" style="color:var(--grafite);font-size:0.85rem">Semana ' + sem.semana + ' do plano (' + esc(state.plano.ritmoAtivo) + ')' +
        (sem.marcos && sem.marcos.length ? ' · ' + esc(sem.marcos.join(' · ')) : '') + '</p>';
    }

    if (filaEstudo.length === 0) {
      if (filaRev.length) {
        // Sem blocos novos, mas há revisões no card acima — não é "dia livre".
        html += '<div class="estado-vazio"><span class="bolha bolha-teoria_concluida"></span>' +
          '<strong>Sem blocos novos hoje</strong>Foque nas revisões acima — o resto da teoria está em dia.</div>';
      } else {
        // Dia sem nada agendado: oferece adiantar a próxima matéria e ver a semana.
        const temCronograma = !!(state.plano && !ciclo && sem && !sem.futura && !sem.encerrado);
        const temFuturo = doAtivo(state.agenda).some(function (a) { return a.data > hoje && !a.feito; });
        html += '<div class="estado-vazio"><span class="bolha bolha-teoria_concluida"></span>' +
          '<strong>Dia livre 🎉</strong>Você está em dia — nada agendado para hoje.' +
          (temCronograma
            ? '<div class="compact-actions" style="margin-top:1rem;justify-content:center">' +
              (temFuturo ? '<button class="botao-mini" id="hoje-adiantar">Adiantar próxima matéria</button>' : '') +
              '<a class="botao-mini botao-quieto" href="#planejamento">Ver a semana toda</a></div>'
            : '<p style="margin-top:1rem"><a class="botao botao-secundario" href="#planejamento">Abrir planejamento</a></p>') +
          '</div>';
      }
    } else {
      filaEstudo.forEach(function (item) { html += itemHtmlFila(item); });
    }
    html += '</div>';
    return html;
  }

  // ---------------- Conquistas (gamificação discreta) ----------------
  // Dica amigável (como conquistar) + raridade aproximada (% de usuários da
  // plataforma que têm cada selo). A raridade é curada — quanto menor, mais raro.
  const CONQUISTA_INFO = {
    plano:    { raridade: 92, dica: 'Crie seu primeiro plano de estudos a partir de um edital.' },
    streak7:  { raridade: 41, dica: 'Estude em 7 dias seguidos, sem furar nenhum.' },
    streak30: { raridade: 9,  dica: 'Mantenha a constância por 30 dias seguidos — pouca gente chega aqui.' },
    q100:     { raridade: 55, dica: 'Resolva 100 questões somando todas as suas sessões.' },
    q1000:    { raridade: 14, dica: 'Resolva 1.000 questões no total. Volume vira aprovação.' },
    h50:      { raridade: 33, dica: 'Acumule 50 horas de estudo registradas (timer ou manual).' },
    dom10:    { raridade: 22, dica: 'Marque 10 tópicos como dominados.' },
    meio:     { raridade: 18, dica: 'Conclua 50% dos tópicos do seu edital.' },
    edital:   { raridade: 3,  dica: 'Conclua 100% do edital — a conquista mais rara da plataforma.' },
    sim:      { raridade: 48, dica: 'Registre pelo menos um simulado.' }
  };

  function nivelRaridade(pct) {
    if (pct <= 5) return { classe: 'lendaria', texto: 'Lendária' };
    if (pct <= 15) return { classe: 'epica', texto: 'Épica' };
    if (pct <= 35) return { classe: 'rara', texto: 'Rara' };
    if (pct <= 60) return { classe: 'incomum', texto: 'Incomum' };
    return { classe: 'comum', texto: 'Comum' };
  }

  function conquistasHtml() {
    if (!state.plano && (!state.sessoes || state.sessoes.length === 0)) return '';
    const c = D.conquistas(state, D.hojeISO());
    return '<div class="card conquistas-card"><h3>Conquistas <span class="conquistas-contador">' + c.ganhas + '/' + c.total + '</span></h3>' +
      '<p class="conquistas-dica sub">Toque em uma conquista para ver como desbloquear e sua raridade.</p>' +
      '<div class="conquistas-grade">' + c.lista.map(function (m) {
        const info = CONQUISTA_INFO[m.id] || { raridade: 50 };
        const niv = nivelRaridade(info.raridade);
        return '<button type="button" class="medalha' + (m.ganha ? ' ganha' : '') + ' medalha-' + niv.classe + '" data-conquista="' + esc(m.id) + '">' +
          '<span class="medalha-icone" aria-hidden="true">' + m.icone + '</span>' +
          '<span class="medalha-titulo">' + esc(m.titulo) + '</span></button>';
      }).join('') + '</div></div>';
  }

  // Detalhe de uma conquista (estilo "troféu"): como obter + raridade.
  function abrirConquista(id) {
    const c = D.conquistas(state, D.hojeISO());
    const m = c.lista.find(function (x) { return x.id === id; });
    if (!m) return;
    const info = CONQUISTA_INFO[id] || { raridade: 50, dica: m.desc };
    const niv = nivelRaridade(info.raridade);
    const modal = abrirModal(
      '<div class="conquista-detalhe conquista-detalhe-' + niv.classe + (m.ganha ? ' ganha' : '') + '">' +
      '<span class="conquista-detalhe-icone' + (m.ganha ? '' : ' bloqueada') + '" aria-hidden="true">' + m.icone + '</span>' +
      '<span class="conquista-detalhe-raridade raridade-' + niv.classe + '">' + niv.texto + ' · ' + info.raridade + '% dos usuários têm</span>' +
      '<h3>' + esc(m.titulo) + '</h3>' +
      '<p class="sub conquista-detalhe-dica">' + esc(info.dica || m.desc) + '</p>' +
      '<p class="conquista-detalhe-status">' + (m.ganha ? '✅ Desbloqueada' : '🔒 Ainda não conquistada') + '</p>' +
      '</div>' +
      '<div class="modal-acoes"><button type="button" id="conq-ok">Fechar</button></div>'
    );
    modal.classList.add('modal-dialogo');
    modal.querySelector('#conq-ok').addEventListener('click', fecharModal);
  }

  // Som curto de comemoração via Web Audio (sem arquivos). O timbre/escala muda
  // conforme a raridade: selos raros ganham um arpejo mais "épico".
  let _audioCtx = null;
  function tocarSomConquista(raridade) {
    if (state.config && state.config.somConquistasOff) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      _audioCtx = _audioCtx || new Ctx();
      const ctx = _audioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      // escala maior (comum) vs. acorde mais brilhante/longo (raro)
      const raro = raridade <= 15;
      const notas = raro ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [523.25, 659.25, 783.99];
      const passo = raro ? 0.12 : 0.1;
      const t0 = ctx.currentTime;
      notas.forEach(function (f, i) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = raro ? 'triangle' : 'sine';
        osc.frequency.value = f;
        const ini = t0 + i * passo;
        g.gain.setValueAtTime(0.0001, ini);
        g.gain.exponentialRampToValueAtTime(0.22, ini + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ini + passo + 0.18);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(ini); osc.stop(ini + passo + 0.2);
      });
    } catch (e) { /* áudio é opcional — silencia falhas */ }
  }

  // Overlay de comemoração com animação específica por selo + som + confete.
  function celebrarConquista(m) {
    const info = CONQUISTA_INFO[m.id] || { raridade: 50, dica: m.desc };
    const niv = nivelRaridade(info.raridade);
    const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduz) confete();
    tocarSomConquista(info.raridade);
    const fundo = document.createElement('div');
    fundo.className = 'celebra-fundo celebra-' + niv.classe + (reduz ? ' sem-anima' : '');
    fundo.innerHTML = '<div class="celebra-cartao celebra-anim-' + esc(m.id) + '">' +
      '<span class="celebra-faixa raridade-' + niv.classe + '">' + niv.texto + ' · ' + info.raridade + '%</span>' +
      '<span class="celebra-icone" aria-hidden="true">' + m.icone + '</span>' +
      '<span class="celebra-rotulo">Conquista desbloqueada!</span>' +
      '<strong class="celebra-titulo">' + esc(m.titulo) + '</strong>' +
      '<span class="celebra-dica">' + esc(info.dica || m.desc) + '</span>' +
      '</div>';
    function fechar() { document.removeEventListener('keydown', aoTecla); fundo.classList.add('saindo'); setTimeout(function () { fundo.remove(); }, 280); }
    function aoTecla(e) { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') fechar(); }
    fundo.addEventListener('click', fechar);
    document.addEventListener('keydown', aoTecla);
    document.body.appendChild(fundo);
    setTimeout(fechar, 4200); // some sozinho; o usuário também pode tocar para fechar
  }

  // Festeja conquistas recém-obtidas (uma vez), uma de cada vez. Usuários já
  // existentes têm o estado inicial registrado sem festa retroativa.
  function celebrarConquistasNovas() {
    const c = D.conquistas(state, D.hojeISO());
    const ganhasIds = c.lista.filter(function (m) { return m.ganha; }).map(function (m) { return m.id; });
    if (!Array.isArray(state.config.conquistasVistas)) {
      state.config.conquistasVistas = ganhasIds;
      salvar({ sincronizar: false });
      return;
    }
    const novas = ganhasIds.filter(function (id) { return state.config.conquistasVistas.indexOf(id) < 0; });
    if (novas.length === 0) return;
    state.config.conquistasVistas = state.config.conquistasVistas.concat(novas);
    salvar({ sincronizar: false });
    const novasMedalhas = c.lista.filter(function (m) { return novas.indexOf(m.id) >= 0; });
    // mostra as comemorações em sequência (uma de cada vez)
    novasMedalhas.forEach(function (m, i) {
      setTimeout(function () { celebrarConquista(m); }, i * 1200);
    });
  }

  function ligarHoje(raiz) {
    celebrarConquistasNovas();
    // Convite ao aprofundamento (plano concluído) tem prioridade sobre o modal de
    // "meta do dia" para não abrirem dois modais no mesmo render.
    if (!talvezConvidarAprofundamento()) talvezComemorarDia();
    setTimeout(talvezAvisarProvaPassada, 0);
    raiz.querySelectorAll('.prova-editar').forEach(function (b) { b.addEventListener('click', abrirEditarProva); });
    const adiantar = raiz.querySelector('#hoje-adiantar');
    if (adiantar) adiantar.addEventListener('click', adiantarProximaMateria);
    const novaFase = raiz.querySelector('#hoje-nova-fase');
    if (novaFase) novaFase.addEventListener('click', function () { abrirGerarPlanoComRotina(); });
    raiz.querySelectorAll('[data-conquista]').forEach(function (el) {
      el.addEventListener('click', function () { abrirConquista(el.getAttribute('data-conquista')); });
    });
    const verMais = raiz.querySelector('[data-painel-vermais]');
    if (verMais) verMais.addEventListener('click', function () {
      // estado fora do DOM: o re-render abaixo já reflete o novo texto/classe.
      painelDiscExpandido = !painelDiscExpandido;
      render();
    });
    const metaQBtn = raiz.querySelector('[data-editar-meta]');
    if (metaQBtn) metaQBtn.addEventListener('click', editarMetaQuestoes);
    raiz.querySelectorAll('[data-disc-detalhe]').forEach(function (linha) {
      const abrir = function () {
        disciplinaDetalheId = linha.getAttribute('data-disc-detalhe');
        location.hash = '#disciplina-' + encodeURIComponent(disciplinaDetalheId);
      };
      linha.addEventListener('click', abrir);
      linha.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
    });
    raiz.querySelectorAll('[data-check-rapido]').forEach(function (el) {
      el.addEventListener('click', function () {
        registrarRapidoFila(el, el.getAttribute('data-check-rapido'), el.getAttribute('data-id'), el.getAttribute('data-tipo'));
      });
    });
    raiz.querySelectorAll('[data-check-desfazer]').forEach(function (el) {
      el.addEventListener('click', function () {
        desfazerRegistroRapidoFila(el.getAttribute('data-check-desfazer'), el.getAttribute('data-id'), el.getAttribute('data-tipo'));
      });
    });
    raiz.querySelectorAll('[data-acao]').forEach(function (el) {
      el.addEventListener('click', function () {
        const acao = el.getAttribute('data-acao');
        if (acao === 'estudar') {
          timerPreselecao = el.getAttribute('data-id');
          location.hash = '#timer';
        } else if (acao === 'registrar') {
          abrirRegistro({ topicoId: el.getAttribute('data-id'), tipo: el.getAttribute('data-tipo') || 'teoria' });
        } else if (acao === 'ciclo-timer') {
          const topId = el.getAttribute('data-id') ||
            ((D.disciplinaPorId(state, el.getAttribute('data-disc')) || { topicos: [] }).topicos.map(function (t) { return t.id; })[0]);
          if (topId) { timerPreselecao = topId; location.hash = '#timer'; }
          else toast('Crie um tópico para esta disciplina antes de usar o timer.', 'erro');
        } else if (acao === 'ciclo-registrar') {
          const dur = parseInt(el.getAttribute('data-dur'), 10);
          abrirRegistro({
            topicoId: el.getAttribute('data-id') || null,
            disciplinaId: el.getAttribute('data-disc'),
            duracaoMin: dur > 0 ? dur : 30
          });
        } else if (acao === 'vincular-bloco') {
          vincularBlocoEstudado(el.getAttribute('data-id'), el.getAttribute('data-tipo') || 'teoria', el.getAttribute('data-inicio') || D.segundaDaSemana(D.hojeISO()));
        } else if (acao === 'concluir-revisao') {
          abrirConcluirRevisao(el.getAttribute('data-id'));
        } else if (acao === 'timer-revisao') {
          const rev = doAtivo(state.revisoes).find(function (x) { return x.id === el.getAttribute('data-id'); });
          if (rev) iniciarTimerDaRevisao(rev);
        } else if (acao === 'concluir-agenda' || acao === 'timer-agenda') {
          const blocoAg = state.agenda.find(function (a) { return a.id === el.getAttribute('data-id'); });
          if (!blocoAg) return;
          if (acao === 'timer-agenda') {
            const topId = blocoAg.topicoId || (D.disciplinaPorId(state, blocoAg.disciplinaId) || { topicos: [] }).topicos.map(function (t) { return t.id; })[0];
            if (topId) { iniciarTimerDoBloco(blocoAg, topId); }
            else toast('Crie um tópico para esta disciplina antes de usar o timer.', 'erro');
          } else {
            registrarDeAgenda(blocoAg);
          }
        }
      });
    });
  }

  // ---------------- TELA: Timer ----------------
  // Adiciona um tópico criado pelo próprio usuário a uma disciplina do SEU plano
  // ativo (não mexe no catálogo/edital de ninguém). Peso baixo por padrão para não
  // bagunçar o cronograma; fica disponível para estudar, desempenho e revisões.
  function adicionarTopicoUsuario(disciplinaId, nome) {
    nome = (nome || '').trim();
    if (!nome) return null;
    const d = D.disciplinaPorId(state, disciplinaId);
    if (!d) return null;
    // já existe um tópico com esse nome? reaproveita (evita duplicar)
    const existente = d.topicos.find(function (t) { return normalizarBusca(t.nome) === normalizarBusca(nome); });
    if (existente) return existente.id;
    const base = d.id + '-U';
    let n = 1; while (d.topicos.some(function (t) { return t.id === base + n; })) n++;
    const novo = {
      id: base + n, nome: nome, incidencia_pct: 0, prioridade: 3, horas_estimadas: 2,
      semana_sugerida: null, status: 'pendente', reaberto: false, orfao: false,
      adicionadoPeloUsuario: true, criadoEm: D.hojeISO()
    };
    d.topicos.push(novo);
    salvar();
    return novo.id;
  }

  function mensagemErroRenomearTopico(motivo) {
    if (motivo === 'nome_duplicado') return 'Já existe um tópico com esse nome nesta disciplina.';
    if (motivo === 'nome_muito_longo') return 'Use um nome com até 120 caracteres.';
    if (motivo === 'nome_vazio') return 'Informe um nome para o tópico.';
    return 'Não consegui encontrar esse tópico no plano.';
  }

  // Edita somente o nome e mantém o id estável, para não romper agenda, sessões,
  // revisões, timer ou estatísticas já vinculadas ao tópico.
  function abrirEditarNomeTopico(disciplinaId, topicoId, aoSalvar) {
    const disciplina = D.disciplinaPorId(state, disciplinaId);
    const topico = disciplina && (disciplina.topicos || []).find(function (t) { return t.id === topicoId; });
    if (!disciplina || !topico) {
      toast('Não consegui encontrar esse tópico no plano.', 'erro');
      return;
    }
    pedirTexto({
      titulo: 'Editar tópico',
      mensagem: 'O código ' + topico.id + ' e todo o histórico serão mantidos.',
      placeholder: 'Ex.: Atos administrativos',
      valor: topico.nome,
      confirmar: 'Salvar nome',
      maxlength: 120
    }).then(function (nome) {
      if (nome === null) return;
      const resultado = D.renomearTopico(state, disciplina.id, topico.id, nome);
      if (!resultado.ok) {
        toast(mensagemErroRenomearTopico(resultado.motivo), 'erro');
        if (resultado.motivo === 'nome_duplicado') abrirEditarNomeTopico(disciplina.id, topico.id, aoSalvar);
        return;
      }
      if (resultado.alterou) salvar();
      if (aoSalvar) aoSalvar(resultado.topico);
      if (resultado.alterou) toast('Tópico atualizado', 'sucesso');
    });
  }

  function abrirModalAssuntosTimer(disciplinaId, selecionadoId, aoEscolher) {
    const d = D.disciplinaPorId(state, disciplinaId);
    if (!d) return;
    const m = abrirModal(
      '<div class="assuntos-modal-cab"><h3>Assuntos</h3><button type="button" class="modal-x" id="ass-fechar" aria-label="Fechar">×</button></div>' +
      '<input id="ass-busca" type="search" placeholder="Buscar ou criar um assunto">' +
      '<div class="assuntos-lista" id="ass-lista"></div>'
    );
    const tagNovo = '<span class="badge-novo">novo</span>';
    function escolher(id) { aoEscolher(id); fecharModal(); }
    function desenhar() {
      const bruto = m.querySelector('#ass-busca').value.trim();
      const q = normalizarBusca(bruto);
      // relê os tópicos a cada desenho (pode ter acabado de criar um)
      const topicos = (D.disciplinaPorId(state, disciplinaId).topicos || []).filter(function (t) { return !t.orfao; });
      const lista = topicos.filter(function (t) { return !q || normalizarBusca(t.nome).indexOf(q) >= 0; });
      const existeIgual = topicos.some(function (t) { return normalizarBusca(t.nome) === q; });
      let html = lista.map(function (t) {
        return '<button type="button" class="assunto-opcao' + (t.id === selecionadoId ? ' selecionado' : '') + '" data-assunto="' + esc(t.id) + '">' +
          esc(t.nome) + (t.adicionadoPeloUsuario ? ' ' + tagNovo : '') + '</button>';
      }).join('');
      // se digitou algo que não existe, oferece criar como tópico novo
      if (bruto && !existeIgual) {
        html += '<button type="button" class="assunto-opcao assunto-criar" id="ass-criar">+ Adicionar “' + esc(bruto) + '” ' + tagNovo + '</button>';
      }
      if (!html) html = '<div class="estado-vazio" style="padding:1rem">Digite para buscar ou criar um assunto.</div>';
      m.querySelector('#ass-lista').innerHTML = html;
      m.querySelectorAll('[data-assunto]').forEach(function (b) {
        b.addEventListener('click', function () { escolher(b.getAttribute('data-assunto')); });
      });
      const criar = m.querySelector('#ass-criar');
      if (criar) criar.addEventListener('click', function () {
        const id = adicionarTopicoUsuario(disciplinaId, bruto);
        if (id) { toast('Assunto “' + bruto + '” adicionado à disciplina.', 'sucesso'); escolher(id); }
      });
    }
    m.querySelector('#ass-fechar').addEventListener('click', fecharModal);
    m.querySelector('#ass-busca').addEventListener('input', desenhar);
    desenhar();
  }

  function telaTimer() {
    if (state.disciplinas.length === 0) {
      return '<section class="timer-page"><h1 class="sr-only">Timer</h1><div class="card"><div class="estado-vazio">' +
        '<span class="bolha bolha-pendente"></span><strong>Nenhum plano ainda</strong>' +
        'Escolha seu concurso para montar o plano e cronometrar seus estudos.' +
        '<p style="margin-top:1rem"><a class="botao" href="#planos">📚 Escolher meu concurso</a></p>' +
        '<p style="margin-top:0.5rem"><a class="botao-quieto" href="#ajustes" style="font-size:0.85rem">ou importar um plano</a></p></div></div></section>';
    }

    const ativo = window.Timer.estado();
    let selecao = '';
    if (!ativo) {
      const discIni = timerPreselecao ? D.disciplinaDoTopico(state, timerPreselecao) : state.disciplinas[0];
      const optsDisc = state.disciplinas.map(function (d) {
        return '<option value="' + esc(d.id) + '"' + (discIni && d.id === discIni.id ? ' selected' : '') + '>' + esc(nomeDiscCurto(d.nome)) + '</option>';
      }).join('') +
        '<option value="' + ID_SIM_TIMER + '">📝 Simulado</option>';
      selecao =
        '<div class="timer-disciplina-topo"><select id="timer-disc" class="timer-disc-select" aria-label="Disciplina">' + optsDisc + '</select>' +
        '<button type="button" class="timer-assunto-btn" id="timer-assunto-btn">Adicionar assunto <span class="timer-assunto-caret" aria-hidden="true">⌄</span></button>' +
        '<input type="hidden" id="timer-topico" value="' + esc(timerPreselecao || '') + '">' +
        '<div class="timer-assunto-escolhido" id="timer-assunto-escolhido"></div></div>' +
        '<div class="timer-modos-wrap"><span class="seletor-modo">' +
        '<button type="button" data-modo="cronometro" class="ativo">Cronômetro</button>' +
        '<button type="button" data-modo="pomodoro">Pomodoro 25/5</button></span></div>' +
        '<div class="timer-limite" id="timer-limite-wrap"><label for="timer-limite">Tempo máximo (min)</label>' +
        '<input id="timer-limite" type="number" min="1" max="720" placeholder="Sem limite"' +
        (timerLimitePendente ? ' value="' + timerLimitePendente + '"' : '') + '></div>' +
        '<div class="timer-limite-auto oculto" id="timer-limite-auto">⏱️ Limite automático: 25 min de foco por ciclo</div>';
    } else if (ativo.topicoId === ID_SIM_TIMER) {
      selecao = '<div class="timer-disciplina-topo"><h2>📝 Simulado</h2>' +
        '<p class="timer-topico-ativo">cronometrando o simulado — encerre para preencher o gabarito</p></div>';
    } else if (timerOrfao(ativo)) {
      // Só chega aqui enquanto o estado local ainda não permite sanear (ex.: à
      // espera da nuvem). Deixa claro o que houve em vez de mostrar o id cru.
      selecao = '<div class="timer-disciplina-topo"><h2>Estudo sem plano</h2>' +
        '<p class="timer-topico-ativo">o plano deste cronômetro foi excluído — encerre ou descarte o tempo</p></div>';
    } else {
      const discAtiva = D.disciplinaDoTopico(state, ativo.topicoId);
      selecao = '<div class="timer-disciplina-topo"><h2>' + esc(discAtiva ? nomeDiscCurto(discAtiva.nome) : 'Estudo') + '</h2>' +
        '<p class="timer-topico-ativo">' + esc(nomeTopicoCompleto(ativo.topicoId).replace((discAtiva ? discAtiva.id + ' · ' : ''), '')) + '</p></div>';
    }

    const tempoIni = ativo ? window.Timer.formatar(ativo.modo === 'pomodoro' ? ativo.pomoRestanteMs : ativo.decorridoMs) : '00:00';
    return '<section class="timer-page"><h1 class="sr-only">Timer</h1><div class="tela-timer"><div class="timer-conteudo">' +
      selecao +
      '<div class="timer-relogio-frame">' +
      '<svg class="timer-clock-svg" viewBox="0 0 300 300" aria-hidden="true">' +
      '<defs><linearGradient id="timer-grad" x1="0%" y1="0%" x2="100%" y2="100%">' +
      '<stop offset="0%" stop-color="#7CB1FF"/><stop offset="55%" stop-color="#9D90FF"/><stop offset="100%" stop-color="#C792FF"/>' +
      '</linearGradient></defs>' +
      '<circle class="timer-track" cx="150" cy="150" r="132" fill="none" stroke-width="12"/>' +
      '<circle id="timer-arco" class="timer-arco" cx="150" cy="150" r="132" fill="none" stroke-width="12" stroke-linecap="round" ' +
      'transform="rotate(-90 150 150)" stroke-dasharray="829.4" stroke-dashoffset="829.4"/>' +
      '<g id="timer-dot-g"><circle class="timer-dot" cx="150" cy="18" r="6"/></g>' +
      '</svg>' +
      '<div class="timer-display" id="timer-display">' + tempoIni + '</div>' +
      '</div>' +
      '<div class="timer-modo-info" id="timer-info"></div>' +
      '<div class="timer-acoes" id="timer-acoes"></div>' +
      '</div></div></section>';
  }

  function ligarTimer(raiz) {
    const display = raiz.querySelector('#timer-display');
    const arco = raiz.querySelector('#timer-arco');
    const dotG = raiz.querySelector('#timer-dot-g');
    const ARCO_C = 829.4; // circunferência do anel (2π·132)
    const info = raiz.querySelector('#timer-info');
    const acoes = raiz.querySelector('#timer-acoes');
    const limiteInput = raiz.querySelector('#timer-limite');
    const frame = raiz.querySelector('.timer-relogio-frame');
    let modoEscolhido = 'cronometro';

    // Estado vazio (sem plano): a tela não tem os controles do relógio.
    if (!acoes) return;

    const selDisc = raiz.querySelector('#timer-disc');
    const selTop = raiz.querySelector('#timer-topico');
    if (selDisc) {
      const assuntoBtn = raiz.querySelector('#timer-assunto-btn');
      const assuntoEscolhido = raiz.querySelector('#timer-assunto-escolhido');
      const atualizarAssunto = function () {
        const t = selTop && selTop.value ? D.topicoPorId(state, selTop.value) : null;
        // o nome do assunto escolhido fica DENTRO da própria caixa, não embaixo
        if (assuntoBtn) assuntoBtn.innerHTML = (t ? esc(t.nome) + (t.adicionadoPeloUsuario ? ' <span class="badge-novo">novo</span>' : '') : 'Adicionar assunto') +
          ' <span class="timer-assunto-caret" aria-hidden="true">⌄</span>';
        if (assuntoBtn) assuntoBtn.classList.toggle('tem-assunto', !!t);
        if (assuntoEscolhido) { assuntoEscolhido.textContent = ''; assuntoEscolhido.style.display = 'none'; }
      };
      const preencher = function () {
        // Modo simulado: não há assunto; o tópico é o sentinela e o botão some.
        if (selDisc.value === ID_SIM_TIMER) {
          if (selTop) selTop.value = ID_SIM_TIMER;
          if (assuntoBtn) assuntoBtn.style.display = 'none';
          if (assuntoEscolhido) { assuntoEscolhido.textContent = ''; assuntoEscolhido.style.display = 'none'; }
          return;
        }
        if (assuntoBtn) assuntoBtn.style.display = '';
        const d = D.disciplinaPorId(state, selDisc.value);
        const tops = d ? d.topicos.filter(function (t) { return !t.orfao; }) : [];
        if (selTop && (!selTop.value || selTop.value === ID_SIM_TIMER || !tops.some(function (t) { return t.id === selTop.value; }))) {
          selTop.value = timerPreselecao && tops.some(function (t) { return t.id === timerPreselecao; }) ? timerPreselecao : (tops[0] ? tops[0].id : '');
        }
        atualizarAssunto();
      };
      preencher();
      selDisc.addEventListener('change', preencher);
      if (assuntoBtn) assuntoBtn.addEventListener('click', function () {
        abrirModalAssuntosTimer(selDisc.value, selTop.value, function (topicoId) {
          selTop.value = topicoId;
          atualizarAssunto();
        });
      });
      const limiteWrap = raiz.querySelector('#timer-limite-wrap');
      const limiteAuto = raiz.querySelector('#timer-limite-auto');
      raiz.querySelectorAll('[data-modo]').forEach(function (b) {
        b.addEventListener('click', function () {
          modoEscolhido = b.getAttribute('data-modo');
          raiz.querySelectorAll('[data-modo]').forEach(function (x) { x.classList.toggle('ativo', x === b); });
          // Pomodoro define o limite sozinho (25 min por ciclo): esconde o campo manual.
          const ehPomo = modoEscolhido === 'pomodoro';
          if (limiteWrap) limiteWrap.classList.toggle('oculto', ehPomo);
          if (limiteAuto) limiteAuto.classList.toggle('oculto', !ehPomo);
          // ao escolher Pomodoro o relógio já mostra 25:00 (foco); cronômetro volta a 00:00
          if (!window.Timer.estado()) {
            if (display) display.textContent = ehPomo
              ? window.Timer.formatar(window.Timer.POMO_FOCO_MIN * 60000) : '00:00';
            if (info) info.textContent = ehPomo
              ? 'Pomodoro 25/5 — 25 min de foco, 5 min de pausa' : '';
          }
        });
      });
    }

    function pintar(e) {
      if (!e) return;
      if (display) {
        display.textContent = window.Timer.formatar(e.modo === 'pomodoro' ? e.pomoRestanteMs : e.decorridoMs);
      }
      var secs = (e.decorridoMs / 1000) % 60;
      // ponto orbitando marca os segundos correndo (vida no relógio)
      if (dotG) dotG.setAttribute('transform', 'rotate(' + (secs * 6).toFixed(2) + ' 150 150)');
      // anel de progresso: pomodoro/limite preenchem rumo à meta; cronômetro livre
      // usa a varredura do minuto como respiração visual.
      var prog;
      if (e.modo === 'pomodoro') {
        var faseTotal = (e.pomoFase === 'foco' ? window.Timer.POMO_FOCO_MIN : window.Timer.POMO_PAUSA_MIN) * 60000;
        prog = faseTotal ? (faseTotal - e.pomoRestanteMs) / faseTotal : 0;
      } else if (e.limiteMs) {
        prog = e.decorridoMs / e.limiteMs;
      } else {
        prog = secs / 60;
      }
      prog = Math.max(0, Math.min(1, prog));
      if (arco) arco.style.strokeDashoffset = (ARCO_C * (1 - prog)).toFixed(1);
      // Passou do tempo planejado → destaque verde "tempo extra" (estudou além da meta).
      const passouLimite = e.modo !== 'pomodoro' && e.limiteMin && e.decorridoMs >= e.limiteMs;
      const extraMin = passouLimite ? Math.floor((e.decorridoMs - e.limiteMs) / 60000) : 0;
      if (display) display.classList.toggle('timer-extra', !!passouLimite);
      if (frame) frame.classList.toggle('timer-frame-extra', !!passouLimite);
      if (info) {
        if (e.modo === 'pomodoro') {
          info.textContent = (e.pomoFase === 'foco' ? 'Foco' : 'Pausa') + ' · ciclo ' + (e.pomoCiclos + 1) +
            ' · foco ' + window.Timer.formatar(e.estudoMs) + ' · total ' + window.Timer.formatar(e.decorridoMs);
        } else if (passouLimite) {
          info.innerHTML = '<span class="timer-info-extra">🎉 +' + extraMin + ' min além do planejado</span>';
        } else {
          info.textContent = e.rodando ? 'Estudando' : 'Pausado';
        }
        if (e.limiteMin && !passouLimite) {
          info.textContent += ' · limite em ' + window.Timer.formatar(e.limiteRestanteMs);
        }
      }
      atualizarTituloTimer(e);
    }

    function botoes() {
      const e = window.Timer.estado();
      if (!e) {
        const iniciarTimer = function () {
          if (!selTop || !selTop.value) { toast('Escolha um tópico antes de iniciar.', 'erro'); return; }
          const limiteMin = limiteInput && limiteInput.value ? parseInt(limiteInput.value, 10) : null;
          if (limiteInput && limiteInput.value && (!limiteMin || limiteMin < 1 || limiteMin > 720)) {
            toast('Informe um tempo máximo entre 1 e 720 minutos.', 'erro');
            return;
          }
          prepararAudio();
          pedirPermissaoNotificacao();
          window.Timer.iniciar(selTop.value, modoEscolhido, { limiteMin, blocoId: timerBlocoPendente, revisaoId: timerRevisaoPendente });
          timerPreselecao = null;
          timerBlocoPendente = null;
          timerRevisaoPendente = null;
          timerLimitePendente = null;
          render();
        };
        acoes.innerHTML = '<button id="t-iniciar">Iniciar</button>';
        acoes.querySelector('#t-iniciar').addEventListener('click', iniciarTimer);
        if (info) info.textContent = '';
        // Veio de "Cronometrar" na agenda: já dispara a contagem ao abrir a tela.
        if (timerAutoIniciar) {
          timerAutoIniciar = false;
          if (selTop && selTop.value) iniciarTimer();
        }
        return;
      }
      acoes.innerHTML =
        (e.rodando
          ? '<button class="botao-quieto" id="t-pausar" style="border-color:#3A3D45;color:#F7F8F6">Pausar</button>'
          : '<button class="botao-quieto" id="t-retomar" style="border-color:#3A3D45;color:#F7F8F6">Retomar</button>') +
        '<button id="t-finalizar">Encerrar</button>' +
        '<button class="botao-quieto" id="t-descartar" style="border-color:#3A3D45;color:#9A9DA3">Descartar</button>';
      const bp = acoes.querySelector('#t-pausar');
      if (bp) bp.addEventListener('click', function () { window.Timer.pausar(); botoes(); pintar(window.Timer.estado()); });
      const br = acoes.querySelector('#t-retomar');
      if (br) br.addEventListener('click', function () { prepararAudio(); window.Timer.retomar(); botoes(); pintar(window.Timer.estado()); });
      acoes.querySelector('#t-finalizar').addEventListener('click', function () {
        const fim = window.Timer.finalizar();
        atualizarTituloTimer(null);
        if (fim.topicoId === ID_SIM_TIMER) {
          render();
          abrirNovoSimulado({ duracaoMin: Math.max(1, minutosEstudoTimer(fim)) });
          return;
        }
        // Tópico de um plano excluído: registrar aqui jogaria o tempo na
        // primeira disciplina do plano atual, que não tem nada a ver.
        if (timerOrfao(fim)) {
          toast('O plano deste cronômetro foi excluído — o tempo não pôde ser registrado.', 'erro');
          render();
          return;
        }
        // Timer iniciado a partir de uma revisão: encerra caindo no modal de
        // concluir a revisão, com o tempo cronometrado já preenchido.
        if (fim.revisaoId && state.revisoes.some(function (r) { return r.id === fim.revisaoId && !r.dataConcluida; })) {
          render();
          abrirConcluirRevisao(fim.revisaoId, Math.max(1, minutosEstudoTimer(fim)));
          return;
        }
        abrirRegistro({
          topicoId: fim.topicoId,
          duracaoMin: Math.max(1, minutosEstudoTimer(fim)),
          tipo: 'teoria',
          blocoId: fim.blocoId || null,
          aoSalvar: function () { render(); }
        });
        render();
      });
      acoes.querySelector('#t-descartar').addEventListener('click', function () {
        confirmar({ titulo: 'Descartar tempo?', mensagem: 'O tempo cronometrado será apagado sem registrar o estudo.', confirmar: 'Descartar', perigo: true, icone: '🗑️' })
          .then(function (ok) { if (ok) { window.Timer.descartar(); atualizarTituloTimer(null); render(); } });
      });
    }

    pintarTimerAtual = pintar;
    botoes();
    pintar(window.Timer.estado());
  }

  // Timer rápido em modal central — cronometra de qualquer tela sem ir para a aba.
  function abrirTimerRapido() {
    if (state.disciplinas.length === 0) {
      toast('Importe ou crie um plano para cronometrar.', 'erro');
      if (location.hash !== '#planejamento') location.hash = '#planejamento';
      return;
    }
    const m = abrirModal('<h3>Timer rápido</h3><div id="tr-corpo"></div>');
    m.classList.add('timer-modal');
    const corpo = m.querySelector('#tr-corpo');
    let modoEscolhido = 'cronometro';

    function pintar(e) {
      const disp = m.querySelector('#tr-display');
      const info = m.querySelector('#tr-info');
      if (!e || !disp) return;
      disp.textContent = window.Timer.formatar(e.modo === 'pomodoro' ? e.pomoRestanteMs : e.decorridoMs);
      const passouLimite = e.modo !== 'pomodoro' && e.limiteMin && e.decorridoMs >= e.limiteMs;
      const extraMin = passouLimite ? Math.floor((e.decorridoMs - e.limiteMs) / 60000) : 0;
      disp.classList.toggle('timer-extra', !!passouLimite);
      if (info) {
        if (e.modo === 'pomodoro') {
          info.textContent = (e.pomoFase === 'foco' ? 'Foco' : 'Pausa') + ' · ciclo ' + (e.pomoCiclos + 1) +
            ' · foco ' + window.Timer.formatar(e.estudoMs) + ' · total ' + window.Timer.formatar(e.decorridoMs);
        } else if (passouLimite) {
          info.innerHTML = '<span class="timer-info-extra">🎉 +' + extraMin + ' min além do planejado</span>';
        } else {
          info.textContent = e.rodando ? 'Estudando' : 'Pausado';
        }
        if (e.limiteMin && !passouLimite) {
          info.textContent += ' · limite em ' + window.Timer.formatar(e.limiteRestanteMs);
        }
      }
    }

    function desenhar() {
      const e = window.Timer.estado();
      if (e) {
        corpo.innerHTML =
          '<div class="timer-mini-clock"><div class="timer-display" id="tr-display">00:00</div>' +
          '<div class="timer-modo-info" id="tr-info"></div></div>' +
          '<p class="tr-topico">' + (e.topicoId === ID_SIM_TIMER ? '📝 Simulado em andamento'
            : timerOrfao(e) ? 'Estudo de um plano excluído' : esc(nomeTopicoCompleto(e.topicoId))) + '</p>' +
          '<div class="modal-acoes tr-acoes">' +
          (e.rodando ? '<button class="botao-quieto" id="tr-pausar">Pausar</button>' : '<button class="botao-quieto" id="tr-retomar">Retomar</button>') +
          '<button id="tr-encerrar">Encerrar</button>' +
          '<button class="botao-quieto" id="tr-descartar">Descartar</button></div>' +
          '<div class="modal-acoes" style="margin-top:0.3rem">' +
          '<a class="botao-quieto botao-mini" href="#timer" id="tr-abrir-tela">Abrir em tela cheia</a></div>';
        const bp = corpo.querySelector('#tr-pausar');
        if (bp) bp.addEventListener('click', function () { window.Timer.pausar(); desenhar(); });
        const br = corpo.querySelector('#tr-retomar');
        if (br) br.addEventListener('click', function () { prepararAudio(); window.Timer.retomar(); desenhar(); });
        corpo.querySelector('#tr-encerrar').addEventListener('click', function () {
          const fim = window.Timer.finalizar();
          atualizarTituloTimer(null);
          if (fim.topicoId === ID_SIM_TIMER) { render(); abrirNovoSimulado({ duracaoMin: Math.max(1, minutosEstudoTimer(fim)) }); return; }
          if (timerOrfao(fim)) {
            toast('O plano deste cronômetro foi excluído — o tempo não pôde ser registrado.', 'erro');
            fecharModal();
            render();
            return;
          }
          abrirRegistro({ topicoId: fim.topicoId, duracaoMin: Math.max(1, minutosEstudoTimer(fim)), tipo: 'teoria', blocoId: fim.blocoId || null, aoSalvar: function () { render(); } });
          render();
        });
        corpo.querySelector('#tr-descartar').addEventListener('click', function () {
          confirmar({ titulo: 'Descartar tempo?', mensagem: 'O tempo cronometrado será apagado sem registrar o estudo.', confirmar: 'Descartar', perigo: true, icone: '🗑️' })
            .then(function (ok) { if (ok) { window.Timer.descartar(); atualizarTituloTimer(null); fecharModal(); render(); } });
        });
        const abrirTela = corpo.querySelector('#tr-abrir-tela');
        if (abrirTela) abrirTela.addEventListener('click', fecharModal);
        pintar(e);
      } else {
        const discIni = timerPreselecao ? D.disciplinaDoTopico(state, timerPreselecao) : state.disciplinas[0];
        const optsDisc = state.disciplinas.map(function (d) {
          return '<option value="' + esc(d.id) + '"' + (discIni && d.id === discIni.id ? ' selected' : '') + '>' + esc(nomeDiscCurto(d.nome)) + '</option>';
        }).join('') +
          '<option value="' + ID_SIM_TIMER + '">📝 Simulado</option>';
        corpo.innerHTML =
          '<div class="timer-disciplina-topo"><select id="tr-disc" class="timer-disc-select" aria-label="Disciplina">' + optsDisc + '</select>' +
          '<button type="button" class="timer-assunto-btn" id="tr-assunto-btn">Adicionar assunto <span class="timer-assunto-caret" aria-hidden="true">⌄</span></button>' +
          '<input type="hidden" id="tr-top" value="' + esc(timerPreselecao || '') + '">' +
          '<div class="timer-assunto-escolhido" id="tr-assunto-escolhido"></div></div>' +
          '<div style="margin-top:0.8rem;text-align:center"><span class="seletor-modo">' +
          '<button type="button" data-trmodo="cronometro" class="ativo">Cronômetro</button>' +
          '<button type="button" data-trmodo="pomodoro">Pomodoro 25/5</button></span></div>' +
          '<div class="timer-limite" style="margin:0.8rem auto 0"><label for="tr-limite">Tempo máximo (min)</label>' +
          '<input id="tr-limite" type="number" min="1" max="720" placeholder="Sem limite"></div>' +
          '<div class="modal-acoes"><button class="botao-quieto" id="tr-fechar2">Fechar</button>' +
          '<button class="botao-secundario" id="tr-registrar">Registrar sessão</button>' +
          '<button id="tr-iniciar">Iniciar</button></div>';
        const selDisc = corpo.querySelector('#tr-disc');
        const selTop = corpo.querySelector('#tr-top');
        const assuntoBtn = corpo.querySelector('#tr-assunto-btn');
        const assuntoEscolhido = corpo.querySelector('#tr-assunto-escolhido');
        const atualizarAssunto = function () {
          const t = selTop && selTop.value ? D.topicoPorId(state, selTop.value) : null;
          if (assuntoBtn) assuntoBtn.innerHTML = (t ? esc(t.nome) : 'Adicionar assunto') +
            ' <span class="timer-assunto-caret" aria-hidden="true">⌄</span>';
          if (assuntoBtn) assuntoBtn.classList.toggle('tem-assunto', !!t);
          if (assuntoEscolhido) { assuntoEscolhido.textContent = ''; assuntoEscolhido.style.display = 'none'; }
        };
        const preencher = function () {
          const ehSim = selDisc.value === ID_SIM_TIMER;
          const btnReg = corpo.querySelector('#tr-registrar');
          if (assuntoBtn) assuntoBtn.style.display = ehSim ? 'none' : '';
          if (btnReg) btnReg.style.display = ehSim ? 'none' : ''; // simulado só cronometra
          if (ehSim) {
            if (selTop) selTop.value = ID_SIM_TIMER;
            if (assuntoEscolhido) { assuntoEscolhido.textContent = ''; assuntoEscolhido.style.display = 'none'; }
            return;
          }
          const d = D.disciplinaPorId(state, selDisc.value);
          const tops = d ? d.topicos.filter(function (t) { return !t.orfao; }) : [];
          if (selTop && (!selTop.value || selTop.value === ID_SIM_TIMER || !tops.some(function (t) { return t.id === selTop.value; }))) {
            selTop.value = timerPreselecao && tops.some(function (t) { return t.id === timerPreselecao; }) ? timerPreselecao : (tops[0] ? tops[0].id : '');
          }
          atualizarAssunto();
        };
        preencher();
        selDisc.addEventListener('change', preencher);
        corpo.querySelector('#tr-assunto-btn').addEventListener('click', function () {
          abrirModalAssuntosTimer(selDisc.value, selTop.value, function (topicoId) {
            timerPreselecao = topicoId;
            setTimeout(abrirTimerRapido, 0);
          });
        });
        corpo.querySelectorAll('[data-trmodo]').forEach(function (b) {
          b.addEventListener('click', function () {
            modoEscolhido = b.getAttribute('data-trmodo');
            corpo.querySelectorAll('[data-trmodo]').forEach(function (x) { x.classList.toggle('ativo', x === b); });
          });
        });
        corpo.querySelector('#tr-fechar2').addEventListener('click', fecharModal);
        // Registrar sessão direto, sem cronometrar (forma prática pedida)
        corpo.querySelector('#tr-registrar').addEventListener('click', function () {
          if (!selTop.value) { toast('Escolha um tópico antes de registrar.', 'erro'); return; }
          const topId = selTop.value;
          fecharModal();
          abrirRegistro({ topicoId: topId, aoSalvar: function () { render(); } });
        });
        corpo.querySelector('#tr-iniciar').addEventListener('click', function () {
          if (!selTop.value) { toast('Escolha um tópico antes de iniciar.', 'erro'); return; }
          const limiteEl = corpo.querySelector('#tr-limite');
          const limiteMin = limiteEl && limiteEl.value ? parseInt(limiteEl.value, 10) : null;
          if (limiteEl && limiteEl.value && (!limiteMin || limiteMin < 1 || limiteMin > 720)) { toast('Informe um tempo máximo entre 1 e 720 minutos.', 'erro'); return; }
          prepararAudio();
          pedirPermissaoNotificacao();
          window.Timer.iniciar(selTop.value, modoEscolhido, { limiteMin: limiteMin });
          timerPreselecao = null;
          desenhar();
        });
      }
    }

    pintarTimerModal = pintar;
    desenhar();
  }

  // ---------------- TELA: Revisões (F4) ----------------
  function abrirConcluirRevisao(revisaoId, duracaoMin) {
    const rev = state.revisoes.find(function (r) { return r.id === revisaoId; });
    if (!rev) return;
    const durIni = duracaoMin && duracaoMin > 0 ? Math.min(300, Math.round(duracaoMin)) : 15;
    const m = abrirModal(
      '<h3>Concluir revisão ' + esc(rev.tipo) + '</h3>' +
      '<p>' + esc(nomeTopicoCompleto(rev.topicoId)) + '</p>' +
      '<form id="form-rev">' +
      '<div class="grade-2">' +
      '<div><label for="rev-feitas">Questões feitas (opcional)</label><input id="rev-feitas" type="number" min="0" max="999" value="0"></div>' +
      '<div><label for="rev-certas">Acertos</label><input id="rev-certas" type="number" min="0" max="999" value="0"></div>' +
      '</div>' +
      '<div class="grade-2"><div><label for="rev-dur">Tempo (min)</label><input id="rev-dur" type="number" min="1" max="300" value="' + durIni + '"></div></div>' +
      '<div class="msg-erro oculto" id="rev-erro"></div>' +
      '<div class="modal-acoes">' +
      '<button type="button" class="botao-quieto" id="rev-cancelar">Cancelar</button>' +
      '<button type="submit">Preencher a bolha</button></div></form>'
    );
    m.querySelector('#rev-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#form-rev').addEventListener('submit', function (e) {
      e.preventDefault();
      const feitas = parseInt(m.querySelector('#rev-feitas').value, 10) || 0;
      const certas = parseInt(m.querySelector('#rev-certas').value, 10) || 0;
      const dur = parseInt(m.querySelector('#rev-dur').value, 10) || 15;
      const erroEl = m.querySelector('#rev-erro');
      if (certas > feitas) { erroEl.textContent = 'Acertos não podem superar as questões feitas.'; erroEl.classList.remove('oculto'); return; }

      rev.dataConcluida = D.hojeISO();
      rev.resultadoPct = feitas > 0 ? Math.round((certas / feitas) * 100) : null;

      const sessaoRevisao = {
        id: window.Store.novoId('ses'), planoId: state.planoAtivoId, data: rev.dataConcluida, topicoId: rev.topicoId,
        tipo: 'revisao', duracaoMin: dur, qFeitas: feitas, qCertas: certas, obs: 'Revisão ' + rev.tipo,
        revisaoId: rev.id
      };
      state.sessoes.push(sessaoRevisao);
      rev.duracaoConcluidaMin = dur;
      rev.sessaoId = sessaoRevisao.id;

      // Curva do esquecimento adaptativa: o desempenho da revisão ajusta o tópico.
      const t = D.topicoPorId(state, rev.topicoId);
      const incT = t ? t.incidencia_pct : null;
      const aj = D.ajustePosRevisao(rev, rev.resultadoPct, feitas, incT);
      if (t) {
        if (aj.subirPrioridade) t.prioridade = Math.max(1, (t.prioridade || 2) - 1);
        if (aj.reabrir) { t.status = 'em_curso'; t.reaberto = true; }
        else if (aj.dominar) t.status = 'dominado';
      }
      if (aj.revisaoExtraDias != null) {
        state.revisoes.push(Object.assign(
          D.revisaoReforco(rev.topicoId, rev.dataConcluida, aj.revisaoExtraDias),
          { planoId: state.planoAtivoId }
        ));
      }
      // Manutenção pós-curva: agenda a próxima revisão de manutenção, mas só se
      // cabe antes da prova — não polui a prontidão nem cria tarefa pós-prova.
      let manutencaoAgendada = false;
      if (aj.manutencaoDias != null) {
        const prazo = D.prazoProva(state);
        const dataManut = D.addDias(rev.dataConcluida, aj.manutencaoDias);
        if (!prazo || dataManut <= prazo) {
          state.revisoes.push(Object.assign(
            D.revisaoManutencao(rev.topicoId, rev.dataConcluida, aj.manutencaoDias),
            { planoId: state.planoAtivoId }
          ));
          manutencaoAgendada = true;
        }
      }
      // Espaçamento adaptativo: o histórico de acertos do tópico estica (indo bem)
      // ou encurta (indo mal) as próximas revisões pendentes.
      const reag = D.reagendarRevisoesAdaptativo(state.revisoes, rev.topicoId, rev.dataConcluida, D.sessoesDoPlano(state), incT);
      if (aj.reabrir) {
        toast('Desempenho baixo — tópico reaberto, prioridade elevada e reforço em ' + aj.revisaoExtraDias + ' dias.', 'erro');
      } else if (aj.revisaoExtraDias != null) {
        toast('Abaixo de 70% — prioridade elevada e revisão de reforço em ' + aj.revisaoExtraDias + ' dias.', 'erro');
      } else if (aj.dominar) {
        toast('Mandou bem (≥85%) — tópico marcado como dominado ●' + (manutencaoAgendada ? '. Revisão de manutenção em 30 dias.' : '.'), 'sucesso');
      } else if (manutencaoAgendada) {
        toast('Curva concluída — próxima revisão de manutenção em 30 dias.', 'sucesso');
      } else if (reag.ajustadas > 0 && reag.fator > 1) {
        toast('Indo bem neste tópico — espacei as próximas revisões.', 'sucesso');
      } else if (reag.ajustadas > 0 && reag.fator < 1) {
        toast('Aproximei as próximas revisões deste tópico para reforçar.', 'erro');
      } else {
        toast('Revisão concluída — bolha preenchida ●', 'sucesso');
      }
      salvar(); fecharModal(); render();
    });
  }

  let revisoesAba = 'agendadas'; // 'agendadas' | 'flashcards'
  const fcDecksAbertos = new Set(); // ids de decks expandidos (preserva entre re-renders)

  function embaralhar(lista) {
    const a = lista.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // Etiqueta que explica POR QUE uma revisão mudou de data (transparência da
  // adaptação por desempenho). Vazia quando a revisão está no ritmo normal.
  function badgeAdaptacaoRevisao(rev) {
    const est = D.estadoAdaptacaoRevisao(rev);
    if (est === 'reforco') return '<span class="etiqueta etiqueta-rev-antecipada" title="Revisão extra de reforço, criada porque o desempenho ficou baixo.">＋ reforço</span>';
    if (est === 'antecipada') return '<span class="etiqueta etiqueta-rev-antecipada" title="Antecipada: seu desempenho neste tópico ficou abaixo do esperado.">⏩ antecipada</span>';
    if (est === 'espacada') return '<span class="etiqueta etiqueta-rev-espacada" title="Espaçada: você vem indo bem neste tópico, então pode revisar com menos frequência.">🌱 espaçada</span>';
    return '';
  }

  function revisoesAgendadasHtml() {
    const hoje = D.hojeISO();
    const pendentes = doAtivo(state.revisoes)
      .filter(function (r) { return !r.dataConcluida && D.topicoPorId(state, r.topicoId); })
      .sort(function (a, b) { return a.dataAgendada.localeCompare(b.dataAgendada); });

    // Prontidão para a prova: o ciclo de revisões cabe antes da prova?
    const prazo = state.plano ? D.prazoProva(state) : null;
    let html0 = '';
    if (state.plano) {
      if (!prazo) {
        html0 = '<div class="card prontidao-card prontidao-sem-prazo">' +
          '<div><strong>Quando é a sua prova?</strong>' +
          '<p class="sub" style="margin:0.15rem 0 0">Defina a janela da prova para o app avisar se alguma revisão cai depois dela.</p></div>' +
          '<button class="botao-mini" id="rev-definir-prova">Definir prova</button></div>';
      } else {
        const pr = D.prontidaoProva(state, hoje);
        const grau = pr.pct >= 90 ? 'bom' : pr.pct >= 60 ? 'medio' : 'baixo';
        html0 = '<div class="card prontidao-card prontidao-' + grau + '">' +
          '<div class="prontidao-cab"><strong>Preparado para a prova?</strong>' +
          '<span class="prontidao-pct">' + pr.pct + '%</span></div>' +
          '<div class="barra' + (pr.pct >= 90 ? ' barra-verde' : '') + '"><span style="width:' + pr.pct + '%"></span></div>' +
          '<p class="sub prontidao-sub">' + pr.prontos + ' de ' + pr.totalTopicos + ' tópicos com ciclo concluído ou programado até ' + D.formatarDataBR(prazo) + ' (início da janela da prova)' +
          (pr.revisoesForaDoPrazo > 0 ? ' · <span class="prontidao-alerta">' + pr.revisoesForaDoPrazo + (pr.revisoesForaDoPrazo === 1 ? ' revisão cai' : ' revisões caem') + ' depois da prova</span>' : '') +
          (pr.semRevisao > 0 ? ' · <span class="prontidao-alerta">' + pr.semRevisao + (pr.semRevisao === 1 ? ' tópico ainda não entrou' : ' tópicos ainda não entraram') + ' no ciclo</span>' : '') +
          '</p></div>';
      }
    }

    if (pendentes.length === 0) {
      return html0 + '<div class="card"><div class="estado-vazio"><span class="bolha bolha-teoria_concluida"></span>' +
        '<strong>Nenhuma revisão pendente</strong>Conclua a teoria de um tópico (no registro de sessão ou no Edital) para agendar o ciclo 24h · 3d · 7d · 14d · 30d.</div></div>';
    }

    const grupos = [
      { titulo: 'Vencidas', filtro: function (r) { return r.dataAgendada < hoje; }, classe: 'etiqueta-revisao' },
      { titulo: 'Hoje', filtro: function (r) { return r.dataAgendada === hoje; }, classe: 'etiqueta-bloco' },
      { titulo: 'Próximas (7 dias)', filtro: function (r) { return r.dataAgendada > hoje && r.dataAgendada <= D.addDias(hoje, 7); }, classe: 'etiqueta-feito' },
      { titulo: 'Mais adiante', filtro: function (r) { return r.dataAgendada > D.addDias(hoje, 7); }, classe: 'etiqueta-feito' }
    ];

    let html = html0;
    grupos.forEach(function (g) {
      const itens = pendentes.filter(g.filtro);
      if (itens.length === 0) return;
      html += '<div class="card"><h3>' + g.titulo + ' <span style="color:var(--grafite);font-weight:400">(' + itens.length + ')</span></h3>';
      itens.forEach(function (r) {
        const t = D.topicoPorId(state, r.topicoId);
        const d = D.disciplinaDoTopico(state, r.topicoId);
        const podeConcluir = r.dataAgendada <= hoje;
        const aposProva = prazo && r.dataAgendada > prazo;
        html += '<div class="fila-item">' + bolha(t.status) +
          '<div class="fila-info"><div class="fila-titulo">' + (d ? tagDisc(d) + ' ' : '') + esc(t.nome) + '</div>' +
          '<div class="fila-sub">agendada para ' + D.formatarDataBR(r.dataAgendada) + ' · ' + D.formatarMin(D.duracaoRevisaoMin(r.tipo)) + '</div></div>' +
          (aposProva ? '<span class="etiqueta etiqueta-alerta" title="Esta revisão cai depois do início da janela da prova">⚠ depois da prova</span>' : '') +
          badgeAdaptacaoRevisao(r) +
          '<span class="etiqueta ' + g.classe + '">' + esc(r.tipo) + '</span>' +
          (podeConcluir ? '<button class="botao-mini botao-quieto" data-rev-timer="' + esc(r.id) + '">Timer</button>' +
            '<button class="botao-mini" data-rev="' + esc(r.id) + '">Concluir</button>' : '') +
          '</div>';
      });
      html += '</div>';
    });
    return html;
  }

  // Rótulo curto de um intervalo de revisão (1 dia = 24h, senão "Nd").
  function diaLabelRev(d) { return d === 1 ? '24h' : d + 'd'; }

  // Esquema de revisões em vigor (global, em state.config.revisaoEsquema).
  function esquemaRevisaoAtual() {
    const dias = D.intervalosRevisaoConfig(state);
    return dias ? { modo: 'custom', dias: dias } : { modo: 'padrao', dias: D.CURVA_REVISAO_PADRAO_DIAS.slice() };
  }

  // Um tópico é "estudado" quando foi marcado como bagagem ("já estudei/domino") na
  // criação do plano OU teve a teoria concluída/dominada dentro da plataforma — ou
  // ainda quando já tem alguma revisão registrada (curva em andamento).
  function topicoEstudado(t, temRevisao) {
    return !!(t.bagagem || t.status === 'teoria_concluida' || t.status === 'dominado' || temRevisao);
  }

  // Regenera as revisões PENDENTES dos tópicos estudados usando o esquema atual;
  // preserva o que já foi concluído (histórico) e pula as etapas já cumpridas.
  function reaplicarEsquemaRevisao() {
    const intervalos = D.intervalosRevisaoConfig(state);
    const hoje = D.hojeISO();
    const porTop = {};
    doAtivo(state.revisoes).forEach(function (r) { (porTop[r.topicoId] = porTop[r.topicoId] || []).push(r); });
    let afetados = 0;
    Object.keys(porTop).forEach(function (tid) {
      if (!D.topicoPorId(state, tid)) return;
      const revs = porTop[tid];
      const concluidas = revs.filter(function (r) { return r.dataConcluida; });
      const pendentes = revs.filter(function (r) { return !r.dataConcluida; });
      if (pendentes.length === 0) return; // curva já fechada — nada a reagendar
      const idsRemover = new Set(pendentes.map(function (r) { return r.id; }));
      window.Store.marcarRemovido(state, Array.from(idsRemover));
      state.revisoes = state.revisoes.filter(function (r) { return !idsRemover.has(r.id); });
      const novas = D.agendarRevisoes(tid, hoje, { pular24h: true, intervalos: intervalos });
      const restantes = novas.slice(concluidas.length); // pula as etapas já cumpridas
      restantes.forEach(function (r) { r.planoId = state.planoAtivoId; });
      state.revisoes = state.revisoes.concat(restantes);
      afetados++;
    });
    return afetados;
  }

  function estudadosRevisaoHtml() {
    if (!state.plano) {
      return '<div class="card"><div class="estado-vazio"><span class="bolha bolha-pendente"></span>' +
        '<strong>Sem plano ativo</strong>Ative um plano para ver os tópicos já estudados e configurar suas revisões.</div></div>';
    }
    const esq = esquemaRevisaoAtual();
    const custom = esq.modo === 'custom';
    const padraoTxt = D.CURVA_REVISAO_PADRAO_DIAS.map(diaLabelRev).join(' · ');

    let html = '<div class="card rev-esquema-card">' +
      '<h3>Esquema de revisões</h3>' +
      '<p class="sub">Use a curva padrão (baseada em repetição espaçada) ou defina a sua própria sequência de dias — para quem já tem uma lógica de revisão própria.</p>' +
      '<label class="rev-esq-opt"><input type="radio" name="rev-esq" value="padrao"' + (custom ? '' : ' checked') + '>' +
      '<span>Padrão <em>' + padraoTxt + '</em></span></label>' +
      '<label class="rev-esq-opt"><input type="radio" name="rev-esq" value="custom"' + (custom ? ' checked' : '') + '>' +
      '<span>Personalizado</span></label>' +
      '<div class="rev-esq-custom' + (custom ? '' : ' oculto') + '" id="rev-esq-custom">' +
      '<label for="rev-esq-dias">Dias após concluir a teoria (separados por vírgula)</label>' +
      '<input id="rev-esq-dias" type="text" inputmode="numeric" placeholder="1, 7, 15, 30, 60" value="' + esc(custom ? esq.dias.join(', ') : '') + '">' +
      '<p class="sub" style="margin:0.3rem 0 0">Ex.: <code>1, 7, 15, 30, 60</code> agenda 5 revisões nesses intervalos. O último ponto fecha a curva (dominar/manutenção).</p>' +
      '</div>' +
      '<div class="rev-esq-acoes"><button class="botao" id="rev-esq-salvar">Salvar esquema</button></div>' +
      '</div>';

    // Índice de revisões por tópico (para origem e próxima revisão)
    const revsPorTop = {};
    doAtivo(state.revisoes).forEach(function (r) { (revsPorTop[r.topicoId] = revsPorTop[r.topicoId] || []).push(r); });
    const hoje = D.hojeISO();

    const discs = state.disciplinas.filter(function (d) { return d.id !== 'ORF'; });
    let totalEstudados = 0;
    let listas = '';
    discs.forEach(function (d) {
      const tops = (d.topicos || []).filter(function (t) {
        return !t.orfao && topicoEstudado(t, !!(revsPorTop[t.id] && revsPorTop[t.id].length));
      });
      if (tops.length === 0) return;
      totalEstudados += tops.length;
      let linhas = '';
      tops.forEach(function (t) {
        const revs = revsPorTop[t.id] || [];
        const pendentes = revs.filter(function (r) { return !r.dataConcluida; })
          .sort(function (a, b) { return a.dataAgendada.localeCompare(b.dataAgendada); });
        const concluidas = revs.filter(function (r) { return r.dataConcluida; });
        let est;
        if (pendentes.length > 0) {
          const p = pendentes[0];
          const atraso = p.dataAgendada < hoje;
          est = '<span class="rev-est-prox' + (atraso ? ' rev-est-atraso' : '') + '">próxima ' + esc(p.tipo) +
            ' em ' + D.formatarDataBR(p.dataAgendada) + '</span>';
        } else if (concluidas.length > 0) {
          est = '<span class="rev-est-ok">curva concluída (' + concluidas.length + ')</span>';
        } else {
          est = '<button class="botao-mini botao-quieto" data-rev-agendar="' + esc(t.id) + '">Agendar revisões</button>';
        }
        const origem = t.bagagem
          ? '<span class="etiqueta etiqueta-bagagem" title="Marcado como já estudado na criação do plano">🎒 bagagem</span>'
          : '<span class="etiqueta etiqueta-feito" title="Teoria concluída dentro da plataforma">✓ concluído</span>';
        linhas += '<div class="fila-item">' + bolha(t.status) +
          '<div class="fila-info"><div class="fila-titulo">' + esc(t.nome) + '</div>' +
          '<div class="fila-sub">' + est + '</div></div>' + origem + '</div>';
      });
      listas += '<div class="card"><h3>' + tagDisc(d) + ' ' + esc(nomeDiscCurto(d.nome)) +
        ' <span style="color:var(--grafite);font-weight:400">(' + tops.length + ')</span></h3>' + linhas + '</div>';
    });

    if (totalEstudados === 0) {
      html += '<div class="card"><div class="estado-vazio"><span class="bolha bolha-pendente"></span>' +
        '<strong>Nenhum tópico estudado ainda</strong>Marque tópicos como "já estudei" na criação do plano (bagagem) ou conclua a teoria de um tópico para ele aparecer aqui.</div></div>';
    } else {
      html += '<p class="sub" style="margin:0.2rem 0 0.6rem">' + totalEstudados + ' tópico(s) já estudado(s) — bagagem + concluídos no plano.</p>' + listas;
    }
    return html;
  }

  function telaRevisoes() {
    let html = '<div class="cab-pagina"><div><h1>Revisões</h1>' +
      '<p class="sub">Ciclo automático de teoria (24h · 3d · 7d · 14d · 30d) e seus flashcards de memorização.</p></div></div>';
    html += '<div class="rev-seg">' +
      '<button class="botao-mini ' + (revisoesAba === 'agendadas' ? '' : 'botao-quieto') + '" data-rev-aba="agendadas">Agendadas</button>' +
      '<button class="botao-mini ' + (revisoesAba === 'estudados' ? '' : 'botao-quieto') + '" data-rev-aba="estudados">Estudados</button>' +
      '<button class="botao-mini ' + (revisoesAba === 'flashcards' ? '' : 'botao-quieto') + '" data-rev-aba="flashcards">Flashcards</button>' +
      '</div>';
    html += revisoesAba === 'flashcards' ? flashcardsHtml()
      : revisoesAba === 'estudados' ? estudadosRevisaoHtml()
      : revisoesAgendadasHtml();
    return html;
  }

  // ---------------- Flashcards (repetição espaçada) ----------------
  function decksDoPlano() {
    return doAtivo(state.flashcards);
  }

  function flashcardsHtml() {
    const hoje = D.hojeISO();
    if (!state.plano) {
      return '<div class="card"><div class="estado-vazio"><span class="bolha bolha-pendente"></span>' +
        '<strong>Sem plano ativo</strong>Crie ou ative um plano para organizar seus flashcards por disciplina.</div></div>';
    }
    const decks = decksDoPlano();
    let devidasTotal = 0, cartasTotal = 0;
    decks.forEach(function (dk) {
      (dk.cards || []).forEach(function (c) { cartasTotal++; if (D.flashcardDevido(c, hoje)) devidasTotal++; });
    });

    let html = '<div class="card fc-topo">' +
      '<div class="fc-topo-acoes">' +
      '<button class="botao" id="fc-aleatorio"' + (devidasTotal ? '' : ' disabled') + '>🔀 Estudo aleatório' + (devidasTotal ? ' (' + devidasTotal + ')' : '') + '</button>' +
      '<button class="botao-secundario fc-ia-breve" id="fc-gerar-ia" type="button" disabled title="Geração automática de flashcards será liberada em breve">✨ IA em breve</button>' +
      '<button class="botao-secundario" id="fc-novo-deck">+ Novo deck</button>' +
      '</div>' +
      '<p class="sub">' + cartasTotal + ' carta(s) no total · ' + devidasTotal + ' para revisar hoje</p>' +
      '</div>';

    if (decks.length === 0) {
      return html + '<div class="card"><div class="estado-vazio"><span class="bolha bolha-pendente"></span>' +
        '<strong>Nenhum flashcard ainda</strong>Crie um deck por disciplina e adicione cartas (frente e verso). A revisão usa repetição espaçada (Errei · Difícil · Bom · Fácil).</div></div>';
    }

    // agrupa decks por disciplina (pasta); disciplinas do plano primeiro, "geral" por último
    const porDisc = {};
    decks.forEach(function (dk) { const k = dk.disciplinaId || '__geral'; (porDisc[k] = porDisc[k] || []).push(dk); });
    const ordem = state.disciplinas.filter(function (d) { return d.id !== 'ORF'; })
      .map(function (d) { return d.id; }).filter(function (id) { return porDisc[id]; });
    Object.keys(porDisc).forEach(function (k) { if (k !== '__geral' && ordem.indexOf(k) < 0) ordem.push(k); });
    if (porDisc['__geral']) ordem.push('__geral');

    let pastas = '';
    ordem.forEach(function (k) {
      const disc = k === '__geral' ? null : D.disciplinaPorId(state, k);
      const nomePasta = disc ? nomeDiscCurto(disc.nome) : 'Sem disciplina';
      pastas += '<div class="card fc-pasta">' +
        '<div class="fc-pasta-cab">' + (disc ? tagDisc(disc) + ' ' : '') + '<h3>' + esc(nomePasta) + '</h3></div>' +
        '<div class="fc-decks">' + porDisc[k].map(function (dk) {
          const cards = dk.cards || [];
          const devidas = cards.filter(function (c) { return D.flashcardDevido(c, hoje); }).length;
          const aberto = fcDecksAbertos.has(dk.id);
          const cartasHtml = cards.length ? cards.map(function (c) {
            return '<div class="fc-carta-linha fc-carta-linha-ro"><div class="fc-carta-fv">' +
              '<strong>' + esc(c.frente) + '</strong><span>' + esc(c.verso) + '</span></div></div>';
          }).join('') : '<p class="sub" style="margin:0">Nenhuma carta ainda — toque em "Cartas" para adicionar.</p>';
          return '<div class="fc-deck' + (cards.length >= 2 ? ' fc-deck-stack' : '') + (aberto ? ' aberto' : '') + '" data-fc-deck="' + esc(dk.id) + '">' +
            '<div class="fc-deck-cab" data-fc-toggle="' + esc(dk.id) + '" role="button" tabindex="0" aria-expanded="' + (aberto ? 'true' : 'false') + '">' +
            '<span class="fc-deck-chevron" aria-hidden="true">▸</span>' +
            '<div class="fc-deck-info"><strong>' + esc(dk.nome) + '</strong>' +
            '<span class="sub">' + cards.length + ' carta(s)' + (devidas ? ' · <span class="fc-devidas">' + devidas + ' a revisar</span>' : (cards.length ? ' · em dia' : '')) + '</span></div>' +
            '<div class="fc-deck-acoes">' +
            '<button class="botao-mini" data-fc-estudar="' + esc(dk.id) + '"' + (cards.length ? '' : ' disabled') + '>Estudar</button>' +
            '<button class="botao-mini botao-quieto" data-fc-gerenciar="' + esc(dk.id) + '">Cartas</button>' +
            '</div></div>' +
            '<div class="fc-deck-cartas"><div class="fc-deck-cartas-inner">' + cartasHtml + '</div></div>' +
            '</div>';
        }).join('') + '</div></div>';
    });
    html += '<div class="fc-pastas">' + pastas + '</div>';
    return html;
  }

  function abrirNovoDeck() {
    if (!state.plano) { toast('Ative um plano antes de criar flashcards.', 'erro'); return; }
    const discs = state.disciplinas.filter(function (d) { return d.id !== 'ORF'; });
    const opts = discs.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(nomeDiscCurto(d.nome)) + '</option>'; }).join('');
    const m = abrirModal('<h3>Novo deck de flashcards</h3>' +
      '<label for="fc-deck-disc">Disciplina</label>' +
      '<select id="fc-deck-disc">' + opts + '<option value="">Sem disciplina (geral)</option></select>' +
      '<label for="fc-deck-nome" style="display:block;margin-top:0.6rem">Nome do deck</label>' +
      '<input id="fc-deck-nome" type="text" maxlength="60" placeholder="Ex.: Princípios constitucionais">' +
      '<div class="modal-acoes"><button class="botao-quieto" id="fc-deck-cancelar">Cancelar</button>' +
      '<button id="fc-deck-criar">Criar deck</button></div>');
    m.querySelector('#fc-deck-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#fc-deck-criar').addEventListener('click', function () {
      const nome = m.querySelector('#fc-deck-nome').value.trim();
      if (!nome) { toast('Dê um nome ao deck.', 'erro'); return; }
      state.flashcards.push({
        id: window.Store.novoId('fcd'), planoId: state.planoAtivoId,
        disciplinaId: m.querySelector('#fc-deck-disc').value || null,
        nome: nome, criadoEm: D.hojeISO(), cards: []
      });
      salvar();
      fecharModal();
      revisoesAba = 'flashcards';
      render();
      toast('Deck criado — adicione cartas', 'sucesso');
    });
  }

  // Geração de flashcards com IA: o aluno cola o material, a IA (via Cloud Function
  // segura) devolve cartas; o aluno revisa e importa para um deck novo ou existente.
  function abrirGerarFlashcardsIA() {
    if (!IA_FLASHCARDS_DISPONIVEL) {
      toast('A geração de flashcards com IA chega em breve.', 'sucesso');
      return;
    }
    if (!state.plano) { toast('Ative um plano antes de gerar flashcards.', 'erro'); return; }
    if (!window.FirebaseSync || typeof window.FirebaseSync.gerarFlashcardsIA !== 'function') {
      toast('Recurso de IA indisponível nesta versão.', 'erro'); return;
    }
    const st = window.FirebaseSync.status ? window.FirebaseSync.status() : null;
    if (!st || !st.usuario) {
      toast('Entre com sua conta Google (em Configurações) para usar a IA.', 'erro'); return;
    }
    const discs = state.disciplinas.filter(function (d) { return d.id !== 'ORF'; });
    const discOpts = discs.map(function (d) {
      return '<option value="' + esc(d.id) + '">' + esc(nomeDiscCurto(d.nome)) + '</option>';
    }).join('') + '<option value="">Sem disciplina (geral)</option>';
    const decksExist = decksDoPlano();
    const deckOpts = '<option value="">➕ Criar novo deck</option>' + decksExist.map(function (dk) {
      return '<option value="' + esc(dk.id) + '">' + esc(dk.nome) + ' (' + (dk.cards || []).length + ')</option>';
    }).join('');

    const m = abrirModal(
      '<h3>✨ Gerar flashcards com IA</h3>' +
      '<p class="sub">Cole o material (resumo, lei, PDF colado) e a IA monta as cartas. Você revisa antes de importar.</p>' +
      '<div class="grade-2">' +
      '<div><label for="fcia-disc">Disciplina</label><select id="fcia-disc">' + discOpts + '</select></div>' +
      '<div><label for="fcia-qtd">Quantas cartas</label><input id="fcia-qtd" type="number" min="1" max="30" value="10"></div>' +
      '</div>' +
      '<label for="fcia-deck" style="display:block;margin-top:0.6rem">Adicionar a</label>' +
      '<select id="fcia-deck">' + deckOpts + '</select>' +
      '<label for="fcia-material" style="display:block;margin-top:0.6rem">Material de estudo</label>' +
      '<textarea id="fcia-material" rows="8" placeholder="Cole aqui o conteúdo que você quer transformar em flashcards..."></textarea>' +
      '<p class="sub" id="fcia-status" style="min-height:1.2em"></p>' +
      '<div id="fcia-preview"></div>' +
      '<div class="modal-acoes"><button class="botao-quieto" id="fcia-cancelar">Cancelar</button>' +
      '<button id="fcia-gerar">Gerar cartas</button></div>'
    );
    m.classList.add('modal-amplo');
    let cartasGeradas = [];

    function setStatus(txt, erro) {
      const el = m.querySelector('#fcia-status');
      if (el) { el.textContent = txt || ''; el.style.color = erro ? 'var(--vermelho, #c0392b)' : 'var(--grafite)'; }
    }
    m.querySelector('#fcia-cancelar').addEventListener('click', fecharModal);

    m.querySelector('#fcia-gerar').addEventListener('click', function () {
      const material = m.querySelector('#fcia-material').value.trim();
      const discId = m.querySelector('#fcia-disc').value;
      const qtd = Math.min(30, Math.max(1, parseInt(m.querySelector('#fcia-qtd').value, 10) || 10));
      if (material.length < 30) { setStatus('Cole um material mais completo (mínimo 30 caracteres).', true); return; }
      const disc = discId ? D.disciplinaPorId(state, discId) : null;
      const btn = m.querySelector('#fcia-gerar');
      btn.disabled = true;
      setStatus('Gerando cartas com a IA… isso pode levar alguns segundos.');
      m.querySelector('#fcia-preview').innerHTML = '';
      window.FirebaseSync.gerarFlashcardsIA({
        material: material,
        disciplina: disc ? disc.nome : '',
        quantidade: qtd
      }).then(function (res) {
        cartasGeradas = (res && res.cards) || [];
        if (cartasGeradas.length === 0) { setStatus('A IA não conseguiu gerar cartas desse material.', true); btn.disabled = false; return; }
        setStatus(cartasGeradas.length + ' carta(s) geradas. Desmarque as que não quiser e importe.');
        renderPreview();
        btn.disabled = false;
        btn.textContent = 'Gerar novamente';
      }).catch(function (err) {
        setStatus((err && err.message) || 'Falha ao gerar com a IA. Tente novamente.', true);
        btn.disabled = false;
      });
    });

    function renderPreview() {
      const prev = m.querySelector('#fcia-preview');
      prev.innerHTML = '<div class="fc-cartas-lista" style="margin-top:0.6rem">' +
        cartasGeradas.map(function (c, i) {
          return '<label class="fc-carta-linha" style="align-items:flex-start;gap:0.5rem">' +
            '<input type="checkbox" class="fcia-sel" data-i="' + i + '" checked style="margin-top:0.3rem">' +
            '<div class="fc-carta-fv"><strong>' + esc(c.frente) + '</strong><span>' + esc(c.verso) + '</span></div></label>';
        }).join('') + '</div>' +
        '<div class="modal-acoes"><button id="fcia-importar">Importar selecionadas</button></div>';
      prev.querySelector('#fcia-importar').addEventListener('click', importar);
    }

    function importar() {
      const sel = [];
      m.querySelectorAll('.fcia-sel').forEach(function (cb) {
        if (cb.checked) sel.push(cartasGeradas[+cb.getAttribute('data-i')]);
      });
      if (sel.length === 0) { setStatus('Selecione pelo menos uma carta.', true); return; }
      let deckId = m.querySelector('#fcia-deck').value;
      let deck = deckId ? state.flashcards.find(function (d) { return d.id === deckId; }) : null;
      if (!deck) {
        const discId = m.querySelector('#fcia-disc').value;
        const disc = discId ? D.disciplinaPorId(state, discId) : null;
        deck = {
          id: window.Store.novoId('fcd'), planoId: state.planoAtivoId,
          disciplinaId: discId || null,
          nome: (disc ? nomeDiscCurto(disc.nome) : 'Geral') + ' · IA',
          criadoEm: D.hojeISO(), cards: []
        };
        state.flashcards.push(deck);
      }
      sel.forEach(function (c) {
        deck.cards.push({
          id: window.Store.novoId('fck'), frente: c.frente, verso: c.verso, criadoEm: D.hojeISO(),
          sr: { intervalo: 0, facilidade: 2.5, repeticoes: 0, lapsos: 0, proximaRevisao: null, ultimaRevisao: null }
        });
      });
      salvar();
      fecharModal();
      revisoesAba = 'flashcards';
      render();
      toast(sel.length + ' carta(s) importada(s) com IA', 'sucesso');
    }
  }

  function abrirEditarCarta(card, aoSalvar) {
    pedirTexto({ titulo: 'Editar frente', mensagem: 'Pergunta / frente da carta.', valor: card.frente, confirmar: 'Próximo', maxlength: 300, multilinha: true }).then(function (frente) {
      if (frente === null) return;
      pedirTexto({ titulo: 'Editar verso', mensagem: 'Resposta / verso da carta.', valor: card.verso, confirmar: 'Salvar', maxlength: 500, multilinha: true }).then(function (verso) {
        if (verso === null) return;
        card.frente = frente; card.verso = verso;
        salvar();
        if (aoSalvar) aoSalvar();
        toast('Carta atualizada', 'sucesso');
      });
    });
  }

  function abrirGerenciarDeck(deckId) {
    // Re-resolve o deck por id a cada uso: evita mutar uma referência obsoleta
    // caso um sync remoto troque state.flashcards com o modal aberto.
    function deckAtual() { return state.flashcards.find(function (d) { return d.id === deckId; }); }
    if (!deckAtual()) return;
    function corpo() {
      const deck = deckAtual();
      if (!deck) return '<h3>Deck removido</h3><div class="modal-acoes"><button class="botao-quieto" id="fc-fechar">Fechar</button></div>';
      const cards = deck.cards || [];
      const lista = cards.length ? cards.map(function (c) {
        return '<div class="fc-carta-linha"><div class="fc-carta-fv"><strong>' + esc(c.frente) + '</strong><span>' + esc(c.verso) + '</span></div>' +
          '<div class="fc-carta-linha-acoes"><button class="botao-mini botao-quieto" data-fc-edit="' + esc(c.id) + '">Editar</button>' +
          '<button class="botao-mini botao-perigo" data-fc-del="' + esc(c.id) + '" aria-label="Excluir carta">✕</button></div></div>';
      }).join('') : '<p class="sub">Nenhuma carta ainda. Adicione a primeira abaixo.</p>';
      return '<h3>Cartas · ' + esc(deck.nome) + '</h3>' +
        '<div class="fc-cartas-lista">' + lista + '</div>' +
        '<div class="fc-add-carta"><label style="display:block">Nova carta</label>' +
        '<textarea id="fc-frente" rows="2" placeholder="Frente (pergunta)"></textarea>' +
        '<textarea id="fc-verso" rows="2" placeholder="Verso (resposta)"></textarea>' +
        '<div class="modal-acoes"><button class="botao-quieto" id="fc-fechar">Fechar</button>' +
        '<button id="fc-add">Adicionar carta</button></div>';
    }
    const m = abrirModal(corpo());
    m.classList.add('modal-amplo');
    function wire() {
      const fechar = m.querySelector('#fc-fechar');
      if (fechar) fechar.addEventListener('click', function () { fecharModal(); render(); });
      const add = m.querySelector('#fc-add');
      if (add) add.addEventListener('click', function () {
        const deck = deckAtual(); if (!deck) return;
        const frente = m.querySelector('#fc-frente').value.trim();
        const verso = m.querySelector('#fc-verso').value.trim();
        if (!frente || !verso) { toast('Preencha frente e verso.', 'erro'); return; }
        deck.cards.push({
          id: window.Store.novoId('fck'), frente: frente, verso: verso, criadoEm: D.hojeISO(),
          sr: { intervalo: 0, facilidade: 2.5, repeticoes: 0, lapsos: 0, proximaRevisao: null, ultimaRevisao: null }
        });
        salvar();
        m.innerHTML = corpo(); wire();
        toast('Carta adicionada', 'sucesso');
      });
      m.querySelectorAll('[data-fc-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          const deck = deckAtual(); if (!deck) return;
          deck.cards = deck.cards.filter(function (c) { return c.id !== b.getAttribute('data-fc-del'); });
          salvar();
          m.innerHTML = corpo(); wire();
        });
      });
      m.querySelectorAll('[data-fc-edit]').forEach(function (b) {
        b.addEventListener('click', function () {
          const deck = deckAtual(); if (!deck) return;
          const c = deck.cards.find(function (x) { return x.id === b.getAttribute('data-fc-edit'); });
          if (c) abrirEditarCarta(c, function () { m.innerHTML = corpo(); wire(); });
        });
      });
    }
    wire();
  }

  // Sessão de estudo: vira a carta e pontua com repetição espaçada.
  function iniciarEstudoFlashcards(cards) {
    if (!cards || cards.length === 0) { toast('Nada para estudar aqui.', 'erro'); return; }
    let fila = cards.slice();
    let feitas = 0;
    const reduz = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function proxima() {
      if (fila.length === 0) {
        const fim = abrirModal('<div class="fc-fim"><div class="fc-fim-emoji" aria-hidden="true">🎉</div>' +
          '<h3>Sessão concluída!</h3><p class="sub">Você revisou ' + feitas + ' carta(s).</p>' +
          '<div class="modal-acoes" style="justify-content:center"><button id="fc-fim-ok">Fechar</button></div></div>');
        fim.querySelector('#fc-fim-ok').addEventListener('click', function () { fecharModal(); render(); });
        return;
      }
      const card = fila[0];
      const m = abrirModal('<div class="fc-sessao">' +
        '<div class="fc-sessao-prog">Restantes: ' + fila.length + '</div>' +
        '<div class="fc-carta' + (reduz ? ' fc-sem-anima' : '') + '" id="fc-carta">' +
        '<div class="fc-carta-face fc-carta-frente"><span>' + esc(card.frente) + '</span></div>' +
        '<div class="fc-carta-face fc-carta-verso"><span>' + esc(card.verso) + '</span></div>' +
        '</div>' +
        '<div class="fc-sessao-acao" id="fc-revelar-wrap"><button class="botao" id="fc-revelar">Mostrar resposta</button></div>' +
        '<div class="fc-sr-acoes oculto" id="fc-sr">' +
        '<button class="botao-mini fc-sr fc-sr-errei" data-nota="errei">Errei</button>' +
        '<button class="botao-mini fc-sr fc-sr-dificil" data-nota="dificil">Difícil</button>' +
        '<button class="botao-mini fc-sr fc-sr-bom" data-nota="bom">Bom</button>' +
        '<button class="botao-mini fc-sr fc-sr-facil" data-nota="facil">Fácil</button>' +
        '</div>' +
        '<div class="modal-acoes" style="justify-content:center"><button class="botao-quieto" id="fc-sair">Encerrar sessão</button></div>' +
        '</div>');
      m.classList.add('modal-amplo');
      m.querySelector('#fc-sair').addEventListener('click', function () { fecharModal(); render(); });
      const carta = m.querySelector('#fc-carta');
      m.querySelector('#fc-revelar').addEventListener('click', function () {
        carta.classList.add('virada');
        m.querySelector('#fc-revelar-wrap').classList.add('oculto');
        m.querySelector('#fc-sr').classList.remove('oculto');
      });
      m.querySelectorAll('[data-nota]').forEach(function (b) {
        b.addEventListener('click', function () {
          const nota = b.getAttribute('data-nota');
          card.sr = D.revisarFlashcard(card.sr, nota, D.hojeISO());
          salvar();
          fila.shift();
          if (nota === 'errei') fila.push(card); // reaparece no fim da sessão
          else feitas++; // conta a carta uma vez, quando sai da fila de vez
          proxima();
        });
      });
    }
    proxima();
  }

  function ligarRevisoes(raiz) {
    raiz.querySelectorAll('[data-rev-aba]').forEach(function (b) {
      b.addEventListener('click', function () { revisoesAba = b.getAttribute('data-rev-aba'); render(); });
    });
    raiz.querySelectorAll('[data-rev]').forEach(function (b) {
      b.addEventListener('click', function () { abrirConcluirRevisao(b.getAttribute('data-rev')); });
    });
    raiz.querySelectorAll('[data-rev-timer]').forEach(function (b) {
      b.addEventListener('click', function () {
        const rev = doAtivo(state.revisoes).find(function (x) { return x.id === b.getAttribute('data-rev-timer'); });
        if (rev) iniciarTimerDaRevisao(rev);
      });
    });
    // Esquema de revisões: alterna o campo personalizado e salva/reaplica.
    raiz.querySelectorAll('input[name="rev-esq"]').forEach(function (r) {
      r.addEventListener('change', function () {
        const box = raiz.querySelector('#rev-esq-custom');
        if (box) box.classList.toggle('oculto', r.value !== 'custom');
      });
    });
    const salvarEsq = raiz.querySelector('#rev-esq-salvar');
    if (salvarEsq) salvarEsq.addEventListener('click', function () {
      const sel = raiz.querySelector('input[name="rev-esq"]:checked');
      const modo = sel ? sel.value : 'padrao';

      function aplicar(esquema, msg) {
        state.config = state.config || {};
        if (esquema) state.config.revisaoEsquema = esquema; else delete state.config.revisaoEsquema;
        const n = reaplicarEsquemaRevisao();
        salvar(); render();
        toast(msg + (n ? ' — ' + n + ' tópico(s) reagendado(s).' : '.'), 'sucesso');
      }

      if (modo !== 'custom') { aplicar(null, 'Voltou para a curva padrão'); return; }

      const bruto = (raiz.querySelector('#rev-esq-dias') || {}).value || '';
      // aceita vírgula, ponto-e-vírgula, espaço ou barra como separador
      const dias = bruto.split(/[,;/\s]+/).map(function (x) { return parseInt(x, 10); });
      const prazo = D.prazoProva(state);
      const diasAteProva = prazo ? D.diffDias(D.hojeISO(), prazo) : null;
      const v = D.validarEsquemaRevisao(dias, { diasAteProva: diasAteProva });
      if (!v.ok) { toast(v.erros[0], 'erro'); return; }

      const esquema = { modo: 'custom', dias: v.dias };
      const salvarMsg = 'Esquema personalizado salvo (' + v.dias.map(diaLabelRev).join(' · ') + ')';
      if (v.avisos.length === 0) { aplicar(esquema, salvarMsg); return; }
      // avisos não bloqueiam — confirma antes de aplicar
      confirmar({
        icone: '⚠️', titulo: 'Revisar espaçamento?',
        mensagem: '• ' + v.avisos.join('\n• ') + '\n\nQuer salvar assim mesmo?',
        confirmar: 'Salvar assim mesmo', cancelar: 'Voltar e ajustar'
      }).then(function (ok) { if (ok) aplicar(esquema, salvarMsg); });
    });
    raiz.querySelectorAll('[data-rev-agendar]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (agendarRevisoesSeNecessario(b.getAttribute('data-rev-agendar'))) { salvar(); render(); toast('Revisões agendadas.', 'sucesso'); }
      });
    });
    const definirProva = raiz.querySelector('#rev-definir-prova');
    if (definirProva) definirProva.addEventListener('click', abrirEditarProva);
    const novoDeck = raiz.querySelector('#fc-novo-deck');
    if (novoDeck) novoDeck.addEventListener('click', abrirNovoDeck);
    const gerarIA = raiz.querySelector('#fc-gerar-ia');
    if (gerarIA && IA_FLASHCARDS_DISPONIVEL) gerarIA.addEventListener('click', abrirGerarFlashcardsIA);
    const aleatorio = raiz.querySelector('#fc-aleatorio');
    if (aleatorio) aleatorio.addEventListener('click', function () {
      const hoje = D.hojeISO();
      const devidas = [];
      decksDoPlano().forEach(function (dk) {
        (dk.cards || []).forEach(function (c) { if (D.flashcardDevido(c, hoje)) devidas.push(c); });
      });
      iniciarEstudoFlashcards(embaralhar(devidas));
    });
    // expande/recolhe o deck (efeito baralho → lista de cartas)
    raiz.querySelectorAll('[data-fc-toggle]').forEach(function (cab) {
      function alternar() {
        const id = cab.getAttribute('data-fc-toggle');
        const deckEl = cab.closest('.fc-deck');
        if (!deckEl) return;
        const aberto = deckEl.classList.toggle('aberto');
        cab.setAttribute('aria-expanded', aberto ? 'true' : 'false');
        if (aberto) fcDecksAbertos.add(id); else fcDecksAbertos.delete(id);
      }
      cab.addEventListener('click', alternar);
      cab.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); }
      });
    });
    raiz.querySelectorAll('[data-fc-estudar]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation(); // não alterna o expand do deck
        const dk = state.flashcards.find(function (d) { return d.id === b.getAttribute('data-fc-estudar'); });
        if (!dk) return;
        const hoje = D.hojeISO();
        let cards = (dk.cards || []).filter(function (c) { return D.flashcardDevido(c, hoje); });
        if (cards.length === 0) cards = (dk.cards || []).slice(); // nada devido: revisa o deck todo
        iniciarEstudoFlashcards(embaralhar(cards));
      });
    });
    raiz.querySelectorAll('[data-fc-gerenciar]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        abrirGerenciarDeck(b.getAttribute('data-fc-gerenciar'));
      });
    });
  }

  // ---------------- TELA: Edital verticalizado ----------------
  // Banner de compatibilidade — só aparece quando o plano ATIVO é combinado
  // (uniu 2 concursos). Com um único concurso, não mostra nada.
  function compatibilidadeEditaisHtml() {
    const comb = state.plano && state.plano.combinado;
    if (!comb) return '';
    const compativel = comb.nivel === 'alta' || comb.nivel === 'moderada';
    const classe = compativel ? 'ok' : 'alerta';
    const icone = compativel ? '🤝' : '⚠️';
    const fontes = (comb.fontes || []).join(' × ');
    return '<div class="card compat-editais compat-' + classe + '">' +
      '<div class="compat-topo"><span class="compat-icone" aria-hidden="true">' + icone + '</span>' +
      '<div><strong>Estes editais são ' + comb.pct + '% compatíveis</strong>' + (fontes ? ' · ' + esc(fontes) : '') + '</div></div>' +
      (comb.mensagem ? '<p class="sub">' + esc(comb.mensagem) + '</p>' : '') +
      enfaseBannerHtml() + '</div>';
  }

  // Linha de ênfase dentro do banner do plano combinado: mostra a divisão de foco
  // (ou "por igual") e um botão para ajustar.
  function enfaseBannerHtml() {
    const enf = state.plano && state.plano.enfase;
    const comb = state.plano && state.plano.combinado;
    const r = comb && comb.rotulos;
    const enc = (comb && comb.encerrados) || [];
    const mes = D.hojeISO().slice(0, 7);
    const passouA = r && r.provaA && mes > r.provaA;
    const passouB = r && r.provaB && mes > r.provaB;
    let texto;
    if (r && enc.length) {
      const restante = enc.indexOf(r.a) >= 0 ? r.b : r.a;
      texto = '🎯 Focando só em <strong>' + esc(restante) + '</strong> (o outro concurso foi encerrado).';
    } else if (enf && enf.split) {
      const p = Math.round(enf.split * 100), s = 100 - p;
      const passou = enf.provaSecundario && mes > enf.provaSecundario;
      texto = passou
        ? '🎯 Prova de <strong>' + esc(enf.secundario) + '</strong> já passou — foco voltou 100% para <strong>' + esc(enf.principal) + '</strong>.'
        : '🎯 Ênfase: <strong>' + p + '%</strong> ' + esc(enf.principal) + ' · <strong>' + s + '%</strong> ' + esc(enf.secundario) + '.';
    } else if (passouA && passouB) {
      texto = '🏁 As provas dos dois concursos já passaram.';
    } else if (passouA || passouB) {
      const saiu = passouA ? r.a : r.b, restante = passouA ? r.b : r.a;
      texto = '🎯 Prova de <strong>' + esc(saiu) + '</strong> já passou — o foco migrou para <strong>' + esc(restante) + '</strong>.';
    } else {
      texto = '⚖️ Estudando os dois por igual.';
    }
    return '<div class="enf-banner"><span class="sub">' + texto + '</span>' +
      '<button type="button" class="botao-mini botao-quieto" id="enf-ajustar">Ajustar ênfase</button></div>';
  }

  // Reabre o seletor de ênfase para um plano combinado já existente, mudando só a
  // priorização (não regera o edital). O ciclo é dinâmico e o calendário futuro
  // se reajusta semana a semana.
  function abrirAjusteEnfase() {
    const comb = state.plano && state.plano.combinado;
    if (!comb || !comb.rotulos) { toast('Ajuste disponível só em planos combinados novos.', 'erro'); return; }
    const rA = comb.rotulos.a, rB = comb.rotulos.b;
    const atual = state.plano.enfase;
    const principalAtual = atual ? atual.principal : '';
    const opcao = function (val, titulo, sub) {
      return '<label class="enf-op"><input type="radio" name="enf-aj-principal" value="' + esc(val) + '"' + (principalAtual === val || (!val && !atual) ? ' checked' : '') + '>' +
        '<span class="enf-op-txt"><strong>' + esc(titulo) + '</strong><span class="sub">' + esc(sub) + '</span></span></label>';
    };
    const m = abrirModal(
      '<h3>Ajustar ênfase</h3>' +
      '<div class="enf-opcoes">' +
      opcao('', 'Estudar os dois por igual', 'Tempo dividido por peso e incidência.') +
      opcao(rA, 'Priorizar ' + rA, 'A maior parte do tempo vai para ' + rA + '.') +
      opcao(rB, 'Priorizar ' + rB, 'A maior parte do tempo vai para ' + rB + '.') +
      '</div>' +
      '<div class="enf-split' + (atual ? '' : ' oculto') + '" id="enf-aj-split-box"><label>Quanto do tempo para o principal?' +
      '<select id="enf-aj-split">' +
      ['0.7', '0.6', '0.8'].map(function (v) {
        const lbl = { '0.7': '70% · 30%', '0.6': '60% · 40%', '0.8': '80% · 20%' }[v];
        return '<option value="' + v + '"' + (atual && String(atual.split) === v ? ' selected' : '') + '>' + lbl + '</option>';
      }).join('') + '</select></label></div>' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="enf-aj-cancelar">Cancelar</button>' +
      '<button type="button" id="enf-aj-salvar">Salvar</button></div>'
    );
    const splitBox = m.querySelector('#enf-aj-split-box');
    m.querySelectorAll('input[name="enf-aj-principal"]').forEach(function (r) {
      r.addEventListener('change', function () { splitBox.classList.toggle('oculto', !r.value); });
    });
    m.querySelector('#enf-aj-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#enf-aj-salvar').addEventListener('click', function () {
      const sel = m.querySelector('input[name="enf-aj-principal"]:checked');
      const enfase = montarEnfase(comb, sel ? sel.value : '');
      if (enfase) enfase.split = parseFloat(m.querySelector('#enf-aj-split').value) || 0.7;
      if (enfase) state.plano.enfase = enfase; else delete state.plano.enfase;
      salvar(); fecharModal(); render();
      toast('Ênfase atualizada', 'sucesso');
    });
  }

  // ---- Aviso quando a data prevista de uma prova chega ----
  // Detecta a prova (do plano simples, ou de UM dos concursos do combinado) que
  // já passou e ainda não foi tratada pelo aluno (provaAvisada).
  function provaPassadaPendente() {
    if (!state.plano) return null;
    const mes = D.hojeISO().slice(0, 7);
    const avisada = state.plano.provaAvisada || '';
    const comb = state.plano.combinado;
    if (comb && comb.rotulos) {
      const r = comb.rotulos, enc = comb.encerrados || [];
      const cands = [];
      if (r.provaA && mes > r.provaA && enc.indexOf(r.a) < 0) cands.push({ prova: r.provaA, rotulo: r.a, outro: r.b, outroProva: r.provaB });
      if (r.provaB && mes > r.provaB && enc.indexOf(r.b) < 0) cands.push({ prova: r.provaB, rotulo: r.b, outro: r.a, outroProva: r.provaA });
      const pend = cands.filter(function (c) { return c.prova > avisada; }).sort(function (a, b) { return a.prova.localeCompare(b.prova); })[0];
      if (!pend) return null;
      pend.combinado = true;
      pend.outroPassou = !!(pend.outroProva && mes > pend.outroProva);
      return pend;
    }
    const jp = state.plano.radar && state.plano.radar.janela_prova;
    const provaMes = jp && jp[0];
    if (provaMes && mes > provaMes && provaMes > avisada) return { combinado: false, prova: provaMes };
    return null;
  }

  function talvezAvisarProvaPassada() {
    if (!state.plano) return;
    const raizModal = document.getElementById('modal-raiz');
    if (raizModal && raizModal.children.length) return; // outro modal aberto: tenta depois
    const info = provaPassadaPendente();
    if (info) abrirDialogoProvaPassada(info);
  }

  function marcarProvaAvisada(prova) {
    if (state.plano) { state.plano.provaAvisada = prova; salvar(); }
  }

  function abrirDialogoProvaPassada(info) {
    let corpo, acoes;
    if (info.combinado && !info.outroPassou) {
      corpo = '<div class="dialogo-icone" aria-hidden="true">🎯</div>' +
        '<h3>A prova de ' + esc(info.rotulo) + ' já passou</h3>' +
        '<p class="sub dialogo-msg">O foco já está migrando para <strong>' + esc(info.outro) + '</strong>. Como quer seguir?</p>';
      acoes = '<button type="button" data-pp="focar">Seguir só com ' + esc(info.outro) + '</button>' +
        '<button type="button" class="botao-secundario" data-pp="data">' + esc(info.rotulo) + ' foi adiado — nova data</button>' +
        '<button type="button" class="botao-quieto" data-pp="manter">Manter os dois</button>';
    } else {
      const titulo = info.combinado ? 'As provas dos dois concursos já passaram' : 'A data da sua prova já passou';
      corpo = '<div class="dialogo-icone" aria-hidden="true">' + (info.combinado ? '🏁' : '🎯') + '</div>' +
        '<h3>' + titulo + '</h3>' +
        '<p class="sub dialogo-msg">O que você quer fazer?</p>';
      // "Excluir", não "arquivar": a ação remove o plano de fato (excluirPlano) —
      // o rótulo antigo sugeria algo reversível e induzia à perda do plano.
      acoes = '<button type="button" data-pp="arquivar">Excluir o plano (estatísticas ficam guardadas)</button>' +
        '<button type="button" class="botao-secundario" data-pp="data">Mudar a data da prova</button>' +
        '<button type="button" class="botao-quieto" data-pp="manter">Manter como está</button>';
    }
    const m = abrirModal('<div class="dialogo-prova">' + corpo + '<div class="modal-acoes modal-acoes-empilhado">' + acoes + '</div></div>');
    m.querySelectorAll('[data-pp]').forEach(function (b) {
      b.addEventListener('click', function () {
        const acao = b.getAttribute('data-pp');
        if (acao === 'manter') { marcarProvaAvisada(info.prova); fecharModal(); return; }
        if (acao === 'focar') {
          const comb = state.plano.combinado; comb.encerrados = comb.encerrados || [];
          if (comb.encerrados.indexOf(info.rotulo) < 0) comb.encerrados.push(info.rotulo);
          if (state.plano.enfase) delete state.plano.enfase;
          marcarProvaAvisada(info.prova);
          salvar(); fecharModal(); render();
          toast('Agora focando só em ' + info.outro, 'sucesso');
          return;
        }
        if (acao === 'arquivar') {
          marcarProvaAvisada(info.prova);
          fecharModal();
          excluirPlano(state.planoAtivoId, false);
          return;
        }
        if (acao === 'data') {
          if (info.combinado && !info.outroPassou) { fecharModal(); abrirNovaDataConcurso(info); }
          else { marcarProvaAvisada(''); fecharModal(); abrirEditarProva(); }
          return;
        }
      });
    });
  }

  // Mini-editor de nova data para um concurso de um plano combinado (ex.: adiado
  // ou próxima edição). Atualiza a data daquele concurso e a referência do plano.
  function abrirNovaDataConcurso(info) {
    const r = state.plano.combinado.rotulos;
    const atualProva = info.rotulo === r.a ? r.provaA : r.provaB;
    const m = abrirModal(
      '<h3>Nova data de ' + esc(info.rotulo) + '</h3>' +
      '<p class="sub">Se o concurso foi adiado ou você vai mirar a próxima edição, escolha o novo mês previsto.</p>' +
      '<label>Mês previsto</label>' + seletorMesHtml('nd-prova', atualProva || hojeMesISO()) +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="nd-cancelar">Cancelar</button>' +
      '<button type="button" id="nd-salvar">Salvar</button></div>'
    );
    ligarSeletoresMes(m);
    m.querySelector('#nd-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#nd-salvar').addEventListener('click', function () {
      const novo = m.querySelector('#nd-prova').value;
      if (!novo) return;
      if (info.rotulo === r.a) r.provaA = novo; else r.provaB = novo;
      const futuras = [r.provaA, r.provaB].filter(Boolean).sort();
      if (futuras.length) {
        const prev = state.plano.radar || {};
        state.plano.radar = Object.assign({}, prev, { janela_prova: [futuras[0], (prev.janela_prova && prev.janela_prova[1]) || futuras[futuras.length - 1]] });
      }
      if (state.plano.enfase && state.plano.enfase.secundario === info.rotulo) state.plano.enfase.provaSecundario = novo;
      state.plano.provaAvisada = '';
      salvar(); fecharModal(); render();
      toast('Data de ' + info.rotulo + ' atualizada', 'sucesso');
    });
  }

  // Selo de bagagem ADAPTATIVO no edital: mostra o nível que o aluno declarou na
  // criação do plano ("já domino"/"já estudei") APENAS enquanto o tópico ainda vive
  // só dessa bagagem — ou seja, sem progresso real na plataforma. Assim que ele
  // começa a estudar aqui (status sai de pendente) ou registra questões, o selo
  // some e quem conta a história passa a ser a bolha de status + a pizza de acertos.
  // Evita o selo fixo virar informação velha/confusa depois.
  function badgeBagagemTopico(t, dt) {
    if (!t || !t.bagagem || t.orfao || t.reaberto) return '';
    if (t.status !== 'pendente') return '';
    if (dt && dt.feitas > 0) return '';
    const txt = t.bagagem === 'domino' ? 'já domino' : 'já estudei';
    return ' <span class="etiqueta etiqueta-bagagem" title="Você marcou este tópico como conhecimento prévio na criação do plano. O selo some assim que você começa a estudá-lo aqui.">🎒 ' + txt + '</span>';
  }

  // Selo "revisado": para assuntos já estudados, mostra que o tópico já passou por
  // revisão de fato (nº de revisões concluídas). Complementa a bolha de status —
  // "concluído" diz que a teoria fechou; "revisado" diz que já foi reforçado.
  function badgeRevisadoTopico(nRevisado) {
    if (!nRevisado) return '';
    const titulo = nRevisado === 1 ? '1 revisão concluída deste tópico' : nRevisado + ' revisões concluídas deste tópico';
    return ' <span class="etiqueta etiqueta-revisado" title="' + esc(titulo) + '">🔁 revisado' + (nRevisado > 1 ? ' ' + nRevisado + '×' : '') + '</span>';
  }

  function telaEdital() {
    if (state.disciplinas.length === 0) {
      return '<h1>Edital</h1><div class="card"><div class="estado-vazio">' +
        '<span class="bolha bolha-pendente"></span><strong>Nenhum plano ainda</strong>' +
        'O edital verticalizado aparece aqui depois que você escolhe seu concurso.' +
        '<p style="margin-top:1rem"><a class="botao" href="#planos">📚 Escolher meu concurso</a></p>' +
        '<p style="margin-top:0.5rem"><a class="botao-quieto" href="#ajustes" style="font-size:0.85rem">ou importar um plano</a></p></div></div>';
    }

    const prog = D.progressoEdital(state);
    const meta = state.plano.meta ? state.plano.meta.corte_pct : 70;
    let html = '<div class="cab-pagina"><div><h1>Edital verticalizado</h1>' +
      '<p class="sub">' + prog.concluidos + ' de ' + prog.total + ' tópicos com teoria concluída (' + prog.pct + '%) · % = incidência nas últimas provas</p></div></div>';

    // Revisões concluídas por tópico (para o selo "revisado") — uma passada só.
    const revisadoPorTopico = {};
    doAtivo(state.revisoes).forEach(function (r) {
      if (r.dataConcluida) revisadoPorTopico[r.topicoId] = (revisadoPorTopico[r.topicoId] || 0) + 1;
    });

    html += '<div class="card card-quieto" style="padding:0.5rem 1rem">';
    state.disciplinas.forEach(function (d) {
      const aberta = editalAbertas.has(d.id);
      const pd = D.progressoDisciplina(d);
      const desemp = D.desempenhoDisciplina(state, d);
      const quentes = idsTopicosQuentes(d.topicos);
      const origem = (state.plano && state.plano.combinado && d.origem) ? d.origem : '';
      const statusPlanejamento = D.statusDisciplinaPlanejamento(d);
      html += '<button class="disc-cab" data-disc="' + esc(d.id) + '" aria-expanded="' + aberta + '">' +
        '<span style="font-family:var(--fonte-mono);color:var(--grafite)">' + (aberta ? '▾' : '▸') + '</span>' +
        tagDisc(d) + ' ' + esc(nomeDiscCurto(d.nome)) +
        (origem ? '<span class="disc-origem" title="Origem da disciplina">' + esc(origem) + '</span>' : '') +
        (statusPlanejamento === D.STATUS_DISCIPLINA.PAUSADA ? '<span class="etiqueta etiqueta-pausada">Pausada</span>' :
          statusPlanejamento === D.STATUS_DISCIPLINA.CONCLUIDA ? '<span class="etiqueta etiqueta-concluida">Concluída</span>' : '') +
        '<span class="disc-prog">' + pd.concluidos + '/' + pd.total + ' · ' + semaforoHtml(desemp, meta) + '</span></button>';
      if (aberta) {
        d.topicos.forEach(function (t) {
          const dt = D.desempenhoTopico(state.sessoes, t.id);
          const erros = Math.max(0, dt.feitas - dt.certas);
          html += '<div class="topico-linha' + (t.orfao ? ' topico-orfao' : '') + '" data-topico="' + esc(t.id) + '" role="button" tabindex="0">' +
            bolha(t.status) +
            '<span class="topico-nome">' + esc(t.nome) + (t.orfao ? ' <em>(órfão — fora do plano atual)</em>' : '') + (t.reaberto ? ' <span class="etiqueta etiqueta-reaberto">reaberto</span>' : '') + badgeBagagemTopico(t, dt) + badgeRevisadoTopico(revisadoPorTopico[t.id] || 0) + '</span>' +
            '<span class="topico-meta topico-meta-pizza">' + pizzaAcertosHtml(dt.certas, erros, { classe: 'pizza-xs', titulo: t.nome }) +
            tagIncidenciaHtml(t.incidencia_pct || 0, quentes.has(t.id)) + '</span></div>';
        });
      }
    });
    html += '</div>';
    return html;
  }

  function abrirTopico(topicoId) {
    const t = D.topicoPorId(state, topicoId);
    const d = D.disciplinaDoTopico(state, topicoId);
    if (!t) return;
    const dt = D.desempenhoTopico(state.sessoes, t.id);
    const statusOpcoes = [
      { val: 'pendente', ic: '○', label: 'Pendente' },
      { val: 'em_curso', ic: '◐', label: 'Em curso' },
      { val: 'teoria_concluida', ic: '✓', label: 'Teoria concluída' },
      { val: 'dominado', ic: '🧠', label: 'Dominado' }
    ];
    const radioHtml = statusOpcoes.map(function (o) {
      return '<label class="status-opt">' +
        '<input type="radio" name="top-status" value="' + o.val + '"' + (t.status === o.val ? ' checked' : '') + '>' +
        '<span class="status-ic' + (o.val === 'dominado' ? ' status-ic-brain' : '') + '">' + o.ic + '</span>' +
        o.label + '</label>';
    }).join('');
    const m = abrirModal(
      '<h3>' + (d ? tagDisc(d) + ' ' : '') + esc(t.nome) + '</h3>' +
      '<p style="font-size:0.85rem;color:var(--grafite)">Incidência: ' + (t.incidencia_pct || 0) + '% · ' +
      (t.horas_estimadas ? '~' + t.horas_estimadas + 'h estimadas · ' : '') +
      'Desempenho: ' + (dt.pct !== null ? dt.certas + '/' + dt.feitas + ' (' + dt.pct + '%)' : 'sem questões ainda') + '</p>' +
      '<div class="status-radio-group">' + radioHtml + '</div>' +
      '<div class="modal-acoes">' +
      '<button type="button" class="botao-quieto" id="top-editar-nome">Editar nome</button>' +
      '<button type="button" class="botao-quieto" id="top-fechar">Fechar</button>' +
      '<button type="button" class="botao-secundario" id="top-estudar">Estudar agora</button>' +
      '<button type="button" id="top-salvar">Salvar status</button></div>'
    );
    m.querySelector('#top-editar-nome').addEventListener('click', function () {
      abrirEditarNomeTopico(d.id, t.id, function (atualizado) {
        const titulo = m.querySelector('h3');
        if (titulo) titulo.innerHTML = (d ? tagDisc(d) + ' ' : '') + esc(atualizado.nome);
      });
    });
    m.querySelector('#top-fechar').addEventListener('click', fecharModal);
    m.querySelector('#top-estudar').addEventListener('click', function () {
      timerPreselecao = t.id; fecharModal(); location.hash = '#timer';
    });
    m.querySelector('#top-salvar').addEventListener('click', function () {
      const checkedInput = m.querySelector('input[name="top-status"]:checked');
      const novo = checkedInput ? checkedInput.value : t.status;
      const antes = t.status;
      const concluindo = (novo === 'teoria_concluida' || novo === 'dominado') && antes !== 'teoria_concluida' && antes !== 'dominado';
      // se há cronômetro deste tópico em andamento, registra a sessão (conta o
      // tempo de hoje e risca o calendário) ao concluir.
      const tEstado = concluindo ? window.Timer.estado() : null;
      if (tEstado && tEstado.topicoId === t.id && minutosEstudoTimer(tEstado) >= 1) {
        t.status = 'em_curso'; // garante que concluirRegistro credite e agende revisões
        window.Timer.finalizar(); atualizarTituloTimer(null);
        concluirRegistro({ topicoId: t.id, tipo: 'teoria', duracaoMin: Math.max(1, minutosEstudoTimer(tEstado)), qFeitas: 0, qCertas: 0, teoriaOk: true });
        if (novo === 'dominado') { t.status = 'dominado'; t.reaberto = false; salvar(); }
        fecharModal(); render();
        toast('Status salvo — estudo de hoje registrado ✓', 'sucesso');
        return;
      }
      t.status = novo;
      if (concluindo) {
        if (agendarRevisoesSeNecessario(t.id)) toast('Revisões agendadas: 24h · 3d · 7d · 14d · 30d', 'sucesso');
      }
      if ((novo === 'pendente' || novo === 'em_curso') && (antes === 'teoria_concluida' || antes === 'dominado')) {
        removerRevisoesPendentes(t.id);
      }
      if (novo === 'dominado') t.reaberto = false;
      salvar(); fecharModal(); render();
      toast('Status salvo', 'sucesso');
    });
  }

  function ligarEdital(raiz) {
    raiz.querySelectorAll('[data-disc]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = b.getAttribute('data-disc');
        if (editalAbertas.has(id)) editalAbertas.delete(id); else editalAbertas.add(id);
        render();
      });
    });
    raiz.querySelectorAll('[data-topico]').forEach(function (linha) {
      const abrir = function () { abrirTopico(linha.getAttribute('data-topico')); };
      linha.addEventListener('click', abrir);
      linha.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
    });
  }

  // ---------------- TELA: Simulados (F3) ----------------
  // Metas de acerto do aluno (Perfil). % geral cai para a nota de corte do plano
  // quando não definida; a meta por disciplina cai para a geral.
  function metaAcertoGeral() {
    const m = state.config && state.config.metaAcertoPct;
    if (m != null && m > 0) return m;
    return (state.plano && state.plano.meta && state.plano.meta.corte_pct) || 70;
  }
  function metaAcertoDisciplina(discId) {
    const mapa = (state.config && state.config.metaAcertoDisc) || {};
    const v = mapa[discId];
    return (v != null && v > 0) ? v : metaAcertoGeral();
  }

  // Ranking acionável: "o que mais cai × seu pior desempenho", com ação direta.
  function rankingAcionavelHtml() {
    const ranking = D.rankingAcionavel(state, 8, D.hojeISO());
    if (!ranking.length) return '';
    let html = '<div class="card"><h3>⚡ Prioridade cirúrgica</h3>' +
      '<p class="sub" style="margin:0 0 0.6rem">Ordenado pelo que <strong>mais cai</strong> × seu <strong>pior desempenho</strong> (× proximidade da prova). Ataque de cima para baixo.</p>';
    ranking.forEach(function (r, i) {
      const d = D.disciplinaPorId(state, r.disciplinaId);
      const metaD = metaAcertoDisciplina(r.disciplinaId);
      const desempTxt = r.pct == null
        ? '<span class="sim-rk-sem">sem questões ainda — diagnostique</span>'
        : '<span class="' + (r.pct >= metaD ? 'painel-acertos' : 'painel-erros') + '">' + r.pct + '% em ' + r.feitas + ' q</span> <span class="sim-rk-meta">(meta ' + metaD + '%)</span>';
      const acao = r.reaberto
        ? '<span class="etiqueta etiqueta-reaberto">na fila</span>'
        : '<div class="fila-acoes">' +
          '<button class="botao-mini botao-quieto" data-sim-timer="' + esc(r.topicoId) + '">Timer</button>' +
          '<button class="botao-mini" data-sim-reg="' + esc(r.topicoId) + '">Questões</button>' +
          '<button class="botao-mini botao-quieto" data-fila="' + esc(r.topicoId) + '">→ fila</button></div>';
      html += '<div class="fila-item sim-rk-item">' +
        '<span class="sim-rk-pos">' + (i + 1) + '</span>' +
        '<div class="fila-info"><div class="fila-titulo">' + (d ? tagDisc(d) + ' ' : '') + esc(r.nome) + '</div>' +
        '<div class="fila-sub">' + tagIncidenciaHtml(r.incidencia, false) + ' · ' + desempTxt + '</div></div>' +
        acao + '</div>';
    });
    return html + '</div>';
  }

  function telaSimulados() {
    if (!state.plano) {
      return '<h1>Simulados</h1><div class="card"><div class="estado-vazio">' +
        '<span class="bolha bolha-pendente"></span><strong>Nenhum plano ainda</strong>' +
        'Escolha seu concurso para registrar simulados e comparar com a meta de corte.' +
        '<p style="margin-top:1rem"><a class="botao" href="#planos">📚 Escolher meu concurso</a></p>' +
        '<p style="margin-top:0.5rem"><a class="botao-quieto" href="#ajustes" style="font-size:0.85rem">ou importar um plano</a></p></div></div>';
    }
    const meta = state.plano.meta.corte_pct;
    const cortes = cortesDoPlanoAtivo();
    const metaTexto = cortes
      ? 'Ampla ' + (cortes.ampla || meta) + '% · CN ' + (cortes.negros || cortes.cn || '—') + '% · PCD ' + (cortes.pcd || '—') + '%'
      : meta + '% (' + esc(state.plano.meta.corte_fonte || 'nota de corte estimada') + ')';
    let html = '<div class="cab-pagina"><div><h1>Simulados</h1>' +
      '<p class="sub">Meta: ' + metaTexto + '</p></div>' +
      '<button id="btn-novo-simulado">Preencher gabarito</button></div>';

    const simuladosAtivos = doAtivo(state.simulados);
    if (simuladosAtivos.length === 0) {
      html += '<div class="card"><div class="estado-vazio"><span class="bolha bolha-pendente"></span>' +
        '<strong>Nenhum simulado registrado</strong>Registre o resultado por disciplina e veja a distância até a zona de nomeação.</div></div>';
      return html;
    }

    const ordenados = [...simuladosAtivos].sort(function (a, b) { return b.data.localeCompare(a.data); });
    ordenados.forEach(function (sim) {
      let totalC = 0, totalQ = 0;
      sim.acertos.forEach(function (a) { totalC += a.certas; totalQ += a.total; });
      const pctGeral = totalQ > 0 ? Math.round((totalC / totalQ) * 100) : null;
      const tituloSimulado = sim.tipo === 'total' ? 'Simulado total' : sim.tipo === 'parcial' ? 'Simulado parcial' : 'Simulado';
      const ritmo = D.ritmoSimulado(sim);
      const tempoTxt = sim.duracaoMin
        ? ' · ⏱️ ' + D.formatarMin(sim.duracaoMin) + (ritmo ? ' (' + ritmo + ' min/questão)' : '')
        : '';
      html += '<div class="card"><h3>' + tituloSimulado +
        ' — ' + D.formatarDataBR(sim.data) + ' · geral: ' + semaforoHtml(pctGeral, meta) + tempoTxt + '</h3>' +
        '<table><thead><tr><th>Disciplina</th><th class="num">Acertos</th><th class="num">%</th><th class="num">vs. meta ' + meta + '%</th></tr></thead><tbody>';
      sim.acertos.forEach(function (a) {
        const d = D.disciplinaPorId(state, a.disciplinaId);
        const pct = a.total > 0 ? Math.round((a.certas / a.total) * 100) : null;
        const rem = a.tipoErro ? D.remediacaoErro(a.tipoErro) : null;
        const tagErro = rem ? ' <span class="etiqueta etiqueta-erro" title="' + esc(rem.dica) + '">' + rem.icone + ' ' + esc(rem.rotulo) + '</span>' : '';
        html += '<tr><td>' + (d ? tagDisc(d) + ' ' + esc(d.nome) : esc(a.disciplinaId)) + tagErro + '</td>' +
          '<td class="num">' + a.certas + '/' + a.total + '</td>' +
          '<td class="num">' + (pct === null ? '—' : pct + '%') + '</td>' +
          '<td class="num">' + semaforoHtml(pct, meta) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    });

    // Análise de erros: onde o aluno perde ponto + remediação dirigida.
    const ana = D.analisarErrosSimulados(simuladosAtivos);
    if (ana.totalClassificado > 0) {
      const rem = D.remediacaoErro(ana.dominante);
      html += '<div class="card"><h3>Análise de erros — onde você perde ponto</h3>';
      if (rem) {
        html += '<div class="erro-remediacao"><strong>' + rem.icone + ' Predominante: ' + esc(rem.rotulo) + '</strong>' +
          '<p class="sub" style="margin:0.2rem 0 0">' + esc(rem.dica) + '</p></div>';
      }
      html += '<div class="erro-barras">';
      D.TIPOS_ERRO.forEach(function (t) {
        const v = ana.porTipo[t];
        if (!v) return;
        const pct = Math.round((v / ana.totalClassificado) * 100);
        const r = D.remediacaoErro(t);
        html += '<div class="erro-linha"><span class="erro-rot">' + r.icone + ' ' + esc(r.rotulo) + '</span>' +
          '<div class="barra"><span style="width:' + pct + '%"></span></div>' +
          '<span class="erro-num">' + pct + '%</span></div>';
      });
      html += '</div>';
      const semClass = ana.totalErros - ana.totalClassificado;
      if (semClass > 0) {
        html += '<p class="sub" style="margin-top:0.6rem">' + semClass + (semClass === 1 ? ' erro' : ' erros') +
          ' sem classificação — marque o tipo no próximo gabarito para afinar a remediação.</p>';
      }
      html += '</div>';
    }

    // Ranking acionável: o que mais cai × seu pior desempenho (substitui a lista
    // simples de "piores tópicos" por uma priorização estratégica com ação).
    html += rankingAcionavelHtml();
    return html;
  }

  function abrirNovoSimulado(opcoes) {
    opcoes = opcoes || {};
    const discs = state.disciplinas.filter(function (d) { return d.id !== 'ORF'; });
    const tempoIni = opcoes.duracaoMin ? String(Math.round(opcoes.duracaoMin)) : '';
    const m = abrirModal(
      '<h3>Preencher gabarito</h3>' +
      (opcoes.duracaoMin ? '<p class="sim-cronometrado">⏱️ Simulado cronometrado: ' + D.formatarMin(Math.round(opcoes.duracaoMin)) + ' registrados.</p>' : '') +
      '<form id="form-sim">' +
      '<div class="grade-2"><div><label for="sim-tipo">Tipo</label><select id="sim-tipo">' +
      '<option value="parcial">Parcial</option><option value="total">Total</option></select></div>' +
      '<div><label for="sim-data">Data</label><input id="sim-data" type="date" value="' + D.hojeISO() + '"></div></div>' +
      '<div><label for="sim-dur">Tempo total (min) — opcional</label><input id="sim-dur" type="number" min="0" max="600" value="' + tempoIni + '" placeholder="ex.: 180"></div>' +
      '<p style="font-size:0.82rem;color:var(--grafite);margin-top:0.75rem">Preencha só as disciplinas que caíram no simulado. O <strong>tipo de erro</strong> é opcional — classifique para receber remediação focada.</p>' +
      '<div class="tabela-rolavel"><table><thead><tr><th>Disciplina</th><th class="num">Acertos</th><th class="num">Questões</th><th>Erro predominante</th></tr></thead><tbody>' +
      discs.map(function (d) {
        return '<tr><td>' + tagDisc(d) + ' ' + esc(d.nome) + '</td>' +
          '<td class="num"><input type="number" min="0" max="200" data-sim-certas="' + esc(d.id) + '" style="width:70px;min-height:36px;padding:0.2rem 0.4rem"></td>' +
          '<td class="num"><input type="number" min="0" max="200" data-sim-total="' + esc(d.id) + '" style="width:70px;min-height:36px;padding:0.2rem 0.4rem"></td>' +
          '<td><select data-sim-erro="' + esc(d.id) + '" style="min-height:36px;padding:0.2rem 0.3rem;font-size:0.82rem">' +
          '<option value="">—</option>' +
          '<option value="conceitual">📖 Conceitual</option>' +
          '<option value="calculo">🧮 Cálculo</option>' +
          '<option value="interpretacao">🔍 Interpretação</option>' +
          '<option value="atencao">🎯 Desatenção</option>' +
          '</select></td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="msg-erro oculto" id="sim-erro"></div>' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="sim-cancelar">Cancelar</button>' +
      '<button type="submit">Registrar simulado</button></div></form>'
    );
    m.querySelector('#sim-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#form-sim').addEventListener('submit', function (e) {
      e.preventDefault();
      const erroEl = m.querySelector('#sim-erro');
      const acertos = [];
      let problema = null;
      state.disciplinas.forEach(function (d) {
        const inC = m.querySelector('[data-sim-certas="' + d.id + '"]');
        if (!inC) return;
        const inT = m.querySelector('[data-sim-total="' + d.id + '"]');
        const c = inC.value === '' ? null : parseInt(inC.value, 10);
        const t = inT.value === '' ? null : parseInt(inT.value, 10);
        if (c === null && t === null) return;
        if (c === null || t === null || t === 0) { problema = d.id + ': preencha acertos E total de questões.'; return; }
        if (c > t) { problema = d.id + ': acertos (' + c + ') maiores que o total (' + t + ').'; return; }
        const entrada = { disciplinaId: d.id, certas: c, total: t };
        // tipo de erro só faz sentido quando houve erro (c < t)
        const inErr = m.querySelector('[data-sim-erro="' + d.id + '"]');
        if (inErr && inErr.value && c < t) entrada.tipoErro = inErr.value;
        acertos.push(entrada);
      });
      if (problema) { erroEl.textContent = problema; erroEl.classList.remove('oculto'); return; }
      if (acertos.length === 0) { erroEl.textContent = 'Preencha ao menos uma disciplina.'; erroEl.classList.remove('oculto'); return; }

      const durEl = m.querySelector('#sim-dur');
      const dur = durEl && durEl.value !== '' ? parseInt(durEl.value, 10) : null;
      const novoSim = {
        id: window.Store.novoId('sim'), planoId: state.planoAtivoId,
        data: m.querySelector('#sim-data').value || D.hojeISO(),
        tipo: m.querySelector('#sim-tipo').value,
        acertos
      };
      if (dur && dur > 0) novoSim.duracaoMin = dur;
      state.simulados.push(novoSim);
      salvar(); fecharModal(); render();
      toast('Simulado registrado', 'sucesso');
    });
  }

  function ligarSimulados(raiz) {
    const btn = raiz.querySelector('#btn-novo-simulado');
    if (btn) btn.addEventListener('click', abrirNovoSimulado);
    raiz.querySelectorAll('[data-fila]').forEach(function (b) {
      b.addEventListener('click', function () {
        const t = D.topicoPorId(state, b.getAttribute('data-fila'));
        if (t) { t.reaberto = true; if (t.status === 'teoria_concluida') t.status = 'em_curso'; }
        salvar(); render();
        toast('Tópico na fila da semana', 'sucesso');
      });
    });
    raiz.querySelectorAll('[data-sim-timer]').forEach(function (b) {
      b.addEventListener('click', function () { timerPreselecao = b.getAttribute('data-sim-timer'); location.hash = '#timer'; });
    });
    raiz.querySelectorAll('[data-sim-reg]').forEach(function (b) {
      b.addEventListener('click', function () { abrirRegistro({ topicoId: b.getAttribute('data-sim-reg'), tipo: 'questoes', aoSalvar: function () { render(); } }); });
    });
  }

  // ---------------- TELA: Estatísticas ----------------
  function dadosHorasPorDisciplina() {
    const porDisc = {};
    state.disciplinas.filter(function (d) { return d.id !== 'ORF'; }).forEach(function (d) {
      porDisc[d.id] = { id: d.id, nome: d.nome, minutos: 0, rotulo: '0min' };
    });
    D.sessoesDoPlano(state).forEach(function (s) {
      const d = D.disciplinaDoTopico(state, s.topicoId);
      if (!d || d.id === 'ORF') return;
      if (!porDisc[d.id]) porDisc[d.id] = { id: d.id, nome: d.nome, minutos: 0, rotulo: '0min' };
      porDisc[d.id].minutos += s.duracaoMin || 0;
    });
    return Object.keys(porDisc).map(function (id) {
      porDisc[id].rotulo = D.formatarMin(porDisc[id].minutos);
      return porDisc[id];
    }).sort(function (a, b) { return b.minutos - a.minutos || a.nome.localeCompare(b.nome); });
  }

  function encurtarTexto(txt, max) {
    txt = String(txt || '');
    return txt.length > max ? txt.slice(0, max - 1) + '…' : txt;
  }

  function dadosTopicosDesempenho(opcoes) {
    opcoes = opcoes || {};
    const porTopico = {};
    D.sessoesDoPlano(state).forEach(function (s) {
      if (!s.qFeitas) return;
      const t = D.topicoPorId(state, s.topicoId);
      const d = D.disciplinaDoTopico(state, s.topicoId);
      if (!t || !d || t.orfao) return;
      if (opcoes.disciplina && d.id !== opcoes.disciplina) return;
      const item = porTopico[t.id] = porTopico[t.id] || {
        id: t.id, topico: t.nome, topicoCurto: encurtarTexto(t.nome, 54),
        disciplina: d.nome, disciplinaId: d.id, qFeitas: 0, qCertas: 0, pct: 0
      };
      item.qFeitas += s.qFeitas || 0;
      item.qCertas += s.qCertas || 0;
    });
    const lista = Object.keys(porTopico).map(function (id) {
      const item = porTopico[id];
      item.pct = item.qFeitas > 0 ? Math.round((item.qCertas / item.qFeitas) * 100) : 0;
      item.topicoCurto = encurtarTexto(item.topico, 54);
      return item;
    });
    const ordem = opcoes.ordem || 'piores';
    lista.sort(function (a, b) {
      if (ordem === 'melhores') return b.pct - a.pct || b.qFeitas - a.qFeitas || a.topico.localeCompare(b.topico);
      if (ordem === 'maisQuestoes') return b.qFeitas - a.qFeitas || a.pct - b.pct || a.topico.localeCompare(b.topico);
      return a.pct - b.pct || b.qFeitas - a.qFeitas || a.topico.localeCompare(b.topico);
    });
    const limite = opcoes.limite === 'todos' ? lista.length : Math.max(1, parseInt(opcoes.limite, 10) || 18);
    return lista.slice(0, limite);
  }

  function canvasGraficoHtml(id, descricao) {
    const texto = String(descricao || 'Gráfico de desempenho');
    return '<canvas class="grafico" id="' + esc(id) + '" role="img" aria-label="' +
      esc(texto) + '">' + esc(texto) + '</canvas>';
  }

  function controlesTopicosDesempenhoHtml() {
    const disciplinasComQuestoes = new Set();
    D.sessoesDoPlano(state).forEach(function (s) {
      if (!s.qFeitas) return;
      const d = D.disciplinaDoTopico(state, s.topicoId);
      if (d && d.id !== 'ORF') disciplinasComQuestoes.add(d.id);
    });
    const optsDisc = state.disciplinas.filter(function (d) {
      return d.id !== 'ORF' && disciplinasComQuestoes.has(d.id);
    }).map(function (d) {
      return '<option value="' + esc(d.id) + '"' + (statsTopicosFiltro.disciplina === d.id ? ' selected' : '') + '>' + esc(nomeDiscCurto(d.nome)) + '</option>';
    }).join('');
    return '<div class="grafico-filtros">' +
      '<select id="stats-topicos-disc" aria-label="Filtrar tópicos por disciplina"><option value="">Todas as disciplinas</option>' + optsDisc + '</select>' +
      '<select id="stats-topicos-ordem" aria-label="Ordenar tópicos por desempenho">' +
      '<option value="piores"' + (statsTopicosFiltro.ordem === 'piores' ? ' selected' : '') + '>Piores rendimentos</option>' +
      '<option value="melhores"' + (statsTopicosFiltro.ordem === 'melhores' ? ' selected' : '') + '>Melhores rendimentos</option>' +
      '<option value="maisQuestoes"' + (statsTopicosFiltro.ordem === 'maisQuestoes' ? ' selected' : '') + '>Mais questões</option>' +
      '</select>' +
      '<select id="stats-topicos-limite" aria-label="Quantidade de tópicos no gráfico">' +
      ['12', '18', '30', '50', 'todos'].map(function (v) {
        const rot = v === 'todos' ? 'Todos' : 'Top ' + v;
        return '<option value="' + v + '"' + (statsTopicosFiltro.limite === v ? ' selected' : '') + '>' + rot + '</option>';
      }).join('') +
      '</select></div>';
  }

  function topicosDesempenhoMobileHtml(dados) {
    const totalQ = dados.reduce(function (n, d) { return n + (d.qFeitas || 0); }, 0);
    const totalC = dados.reduce(function (n, d) { return n + (d.qCertas || 0); }, 0);
    const pctGeral = totalQ > 0 ? Math.round((totalC / totalQ) * 100) : 0;
    function classe(item) {
      if (item.pct >= 70) return 'stats-topico-bom';
      if (item.pct >= 50) return 'stats-topico-medio';
      return 'stats-topico-ruim';
    }
    function cor(item) {
      if (item.pct >= 70) return '#2E7D68';
      if (item.pct >= 50) return '#D6A03A';
      return '#B83A2E';
    }
    const ids = new Set(dados.map(function (d) { return d.id; }));
    const sessoes = D.sessoesDoPlano(state).filter(function (s) {
      return s.qFeitas && ids.has(s.topicoId);
    }).sort(function (a, b) { return a.data.localeCompare(b.data); });
    const anoMes = sessoes.map(function (s) { return (s.data || '').slice(0, 7); }).filter(Boolean);
    const spanAnos = anoMes.length ? (+anoMes[anoMes.length - 1].slice(0, 4) - +anoMes[0].slice(0, 4)) : 0;
    const porAno = spanAnos >= 2;
    const porTopicoPeriodo = {};
    const periodosSet = new Set();
    sessoes.forEach(function (s) {
      const periodo = porAno ? s.data.slice(0, 4) : s.data.slice(0, 7);
      if (!periodo) return;
      periodosSet.add(periodo);
      const chave = s.topicoId + '|' + periodo;
      const item = porTopicoPeriodo[chave] = porTopicoPeriodo[chave] || { topicoId: s.topicoId, periodo: periodo, qFeitas: 0, qCertas: 0 };
      item.qFeitas += s.qFeitas || 0;
      item.qCertas += s.qCertas || 0;
    });
    let periodos = Array.from(periodosSet).sort();
    if (!porAno && periodos.length > 8) periodos = periodos.slice(-8);
    const periodoIndex = new Map(periodos.map(function (p, i) { return [p, i]; }));
    const largura = 320, altura = 150, esquerda = 40, direita = 10, topo = 10, base = 108;
    const passo = periodos.length > 1 ? (largura - esquerda - direita) / (periodos.length - 1) : 0;
    const porTopico = {};
    Object.keys(porTopicoPeriodo).forEach(function (k) {
      const p = porTopicoPeriodo[k];
      if (!periodoIndex.has(p.periodo)) return;
      const item = dados.find(function (d) { return d.id === p.topicoId; });
      if (!item) return;
      const pct = p.qFeitas > 0 ? Math.round((p.qCertas / p.qFeitas) * 100) : 0;
      const x = periodos.length > 1 ? esquerda + periodoIndex.get(p.periodo) * passo : esquerda + (largura - esquerda - direita) / 2;
      const y = topo + ((100 - Math.max(0, Math.min(100, pct))) / 100) * (base - topo);
      (porTopico[p.topicoId] = porTopico[p.topicoId] || { item: item, pontos: [] }).pontos.push({
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        pct: pct
      });
    });
    const series = Object.keys(porTopico).map(function (id) { return porTopico[id]; });
    const linhas = series.map(function (s) {
      if (s.pontos.length < 2) return '';
      const pts = s.pontos.map(function (p) { return p.x + ',' + p.y; }).join(' ');
      return '<polyline points="' + pts + '" stroke="' + cor(s.item) + '"></polyline>';
    }).join('');
    const pontos = series.map(function (s) {
      return s.pontos.map(function (p) {
        return '<circle cx="' + p.x + '" cy="' + p.y + '" r="4.2" fill="' + cor(s.item) + '"></circle>';
      }).join('');
    }).join('');
    const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const rotulosX = periodos.map(function (p, i) {
      const x = periodos.length > 1 ? esquerda + i * passo : esquerda + (largura - esquerda - direita) / 2;
      // eixo X muda sozinho com a filtragem: anos (2024, 2025) quando o histórico
      // passa de 2 anos; senão, nome do mês (jan, fev, out...).
      const rot = porAno ? p : (MESES_ABREV[(+p.slice(5, 7)) - 1] || p.slice(5, 7));
      return '<text class="stats-topicos-x" x="' + x + '" y="138" text-anchor="middle">' + rot + '</text>';
    }).join('');
    // grade do eixo Y em 0 / 25 / 50 / 75 / 100% (os pontos acompanham a %).
    const grade = [100, 75, 50, 25, 0].map(function (n) {
      const y = topo + ((100 - n) / 100) * (base - topo);
      return '<line x1="' + esquerda + '" y1="' + y + '" x2="' + (largura - direita) + '" y2="' + y + '"></line>' +
        '<text class="stats-topicos-y" x="' + (esquerda - 5) + '" y="' + (y + 3) + '" text-anchor="end">' + n + '%</text>';
    }).join('');
    const spark = '<div class="stats-topicos-spark" aria-hidden="true"><svg viewBox="0 0 ' + largura + ' ' + altura + '" focusable="false">' +
      grade +
      '<line class="stats-topicos-eixo" x1="' + esquerda + '" y1="' + base + '" x2="' + (largura - direita) + '" y2="' + base + '"></line>' +
      linhas + pontos + rotulosX +
      '</svg></div>';
    return '<div class="stats-topicos-mobile">' +
      spark +
      '<div class="stats-topicos-resumo"><strong>' + pctGeral + '%</strong><span>' + totalQ + ' questões<br>' + totalC + ' acertos</span></div>' +
      '<div class="stats-topicos-lista">' + dados.map(function (item) {
        return '<div class="stats-topico-item">' +
          '<span class="stats-topico-cor ' + classe(item) + '"></span>' +
          '<span class="stats-topico-nome">' + esc(item.topico) + '</span>' +
          '<strong class="stats-topico-valor">' + item.qCertas + '/' + item.qFeitas + ' (' + item.pct + '%)</strong>' +
          '</div>';
      }).join('') + '</div></div>';
  }

  function telaStats() {
    const hoje = D.hojeISO();
    if (D.sessoesDoPlano(state).length === 0) {
      return '<h1>Desempenho</h1><div class="card"><div class="estado-vazio">' +
        '<span class="bolha bolha-pendente"></span><strong>Sem dados ainda</strong>' +
        'Registre a primeira sessão de estudo e os números aparecem aqui.</div></div>';
    }
    const st = D.streak(D.sessoesDoPlano(state), hoje); // constância do plano ativo (consistente com a faixa/heatmap)
    const meta = D.metaSemanal(state, hoje);
    const prog = D.progressoEdital(state);
    const geral = D.desempenhoGeral(state);
    const metaPct = state.plano && state.plano.meta ? state.plano.meta.corte_pct : 70;
    let totalMin = 0, totalQ = 0, totalC = 0;
    D.sessoesDoPlano(state).forEach(function (s) { totalMin += s.duracaoMin || 0; totalQ += s.qFeitas || 0; totalC += s.qCertas || 0; });

    const statsMobile = window.matchMedia && window.matchMedia('(max-width: 560px)').matches;
    let html = '<h1>Desempenho</h1><div class="linha-cards stats-kpis">' +
      '<div class="card card-kpi stats-kpi-inline"><div class="card-kpi-rotulo">Tempo total</div><div class="card-kpi-valor">' + D.formatarMin(totalMin) + '</div>' +
      '<div class="card-kpi-extra">' + D.formatarMin(meta.minutos) + ' nesta semana</div></div>' +
      '<div class="card card-kpi stats-kpi-inline"><div class="card-kpi-rotulo">Questões</div><div class="card-kpi-valor">' + totalQ + '</div>' +
      '<div class="card-kpi-extra">' + (totalQ > 0 ? Math.round((totalC / totalQ) * 100) + '% de acerto' : '—') + '</div></div>' +
      '<div class="card card-kpi stats-kpi-full"><div class="card-kpi-rotulo">Desempenho × meta</div><div class="card-kpi-valor">' + semaforoHtml(geral, metaPct) + '</div>' +
      '<div class="card-kpi-extra">meta de corte: ' + metaPct + '%</div></div>' +
      '<div class="card card-kpi stats-kpi-full"><div class="card-kpi-rotulo">⚡ Constância</div><div class="card-kpi-valor">' + st.atual + ' ' + (st.atual === 1 ? 'dia' : 'dias') + '</div>' +
      '<div class="card-kpi-extra">recorde: ' + st.recorde + ' · edital: ' + prog.pct + '%</div></div>' +
      '</div>';

    html += '<div class="card stats-constancia-faixa">' + constanciaFaixaHtml(30) + '</div>';

    const horasDisc = dadosHorasPorDisciplina();
    const topicosDesempenho = dadosTopicosDesempenho(statsTopicosFiltro);
    const resumoDisciplinas = state.disciplinas.filter(function (d) { return d.id !== 'ORF'; }).map(function (d) {
      const pct = D.desempenhoDisciplina(state, d);
      return nomeDiscCurto(d.nome) + ': ' + (pct == null ? 'sem questões' : pct + '%');
    }).join('; ') || 'sem disciplinas com questões';
    const resumoSemanas = D.serieSemanal(state, hoje, 8).map(function (s) {
      return (s.inicio || 'semana') + ': ' + (s.horas || 0) + 'h';
    }).join('; ') || 'sem semanas registradas';
    const resumoTopicos = topicosDesempenho.map(function (t) {
      return t.topico + ': ' + t.pct + '% em ' + t.qFeitas + ' questões';
    }).join('; ') || 'sem questões por tópico';
    const resumoHoras = horasDisc.map(function (d) { return d.nome + ': ' + d.rotulo; }).join('; ') || 'sem horas registradas';
    const hDisc = statsMobile ? 340 : 380;
    const hTop = statsMobile ? 360 : Math.max(280, Math.min(640, topicosDesempenho.length * 38 + 86));

    // Desktop: pizza + evolução semanal lado a lado. Mobile: só a pizza (a
    // "Evolução semanal" sai no celular — pedido do usuário) e o gráfico de
    // tópicos vira o de pontos por período (ver topicosDesempenhoMobileHtml).
    if (statsMobile) {
      html += '<div class="card"><h3>Desempenho por disciplina</h3><div class="grafico-box">' + canvasGraficoHtml('graf-meta', 'Desempenho por disciplina. ' + resumoDisciplinas) + '</div></div>';
    } else {
      html += '<div class="stats-linha-graficos">' +
        '<div class="card"><h3>Desempenho por disciplina</h3><div class="grafico-box">' + canvasGraficoHtml('graf-meta', 'Desempenho por disciplina. ' + resumoDisciplinas) + '</div></div>' +
        '<div class="card"><h3>Evolução semanal</h3><div class="grafico-box">' + canvasGraficoHtml('graf-evolucao', 'Evolução semanal. ' + resumoSemanas) + '</div></div>' +
        '</div>';
    }
    html += '<div class="card"><h3>Tópicos × desempenho</h3>' +
      (topicosDesempenho.length > 0
        ? controlesTopicosDesempenhoHtml() + '<div id="stats-topicos-corpo">' + (statsMobile
          ? topicosDesempenhoMobileHtml(topicosDesempenho)
          : '<div class="grafico-box grafico-scroll" style="height:' + hTop + 'px">' + canvasGraficoHtml('graf-topicos', 'Desempenho por tópico. ' + resumoTopicos) + '</div>') + '</div>'
        : '<div class="estado-vazio" style="padding:1.5rem"><span class="bolha bolha-pendente"></span><strong>Sem questões por tópico</strong>Registre questões nas sessões para ver o gráfico.</div>') +
      '</div>';
    html += '<div class="card stats-horas-disc-card"><h3>Disciplinas × horas de estudo</h3><div class="grafico-box grafico-scroll" style="height:' + hDisc + 'px">' + canvasGraficoHtml('graf-horas-disc', 'Horas de estudo por disciplina. ' + resumoHoras) + '</div></div>';
    if (!window.Graficos.disponivel()) {
      html += '<div class="aviso aviso-info">Os gráficos precisam de internet na primeira carga (Chart.js via CDN). Os demais números continuam funcionando offline.</div>';
    }
    return html;
  }

  function ligarStats(raiz) {
    if (!window.Graficos.disponivel()) return;
    const hoje = D.hojeISO();
    const serie = D.serieSemanal(state, hoje, 8);
    const c1 = raiz.querySelector('#graf-evolucao');
    if (c1) window.Graficos.evolucaoSemanal(c1, serie);
    const cHoras = raiz.querySelector('#graf-horas-disc');
    if (cHoras) window.Graficos.disciplinasHoras(cHoras, dadosHorasPorDisciplina());
    const c2 = raiz.querySelector('#graf-meta');
    if (c2 && state.disciplinas.length > 0) {
      const dados = state.disciplinas.filter(function (d) { return d.id !== 'ORF'; }).map(function (d) {
        return { sigla: d.id, pct: D.desempenhoDisciplina(state, d), cor: d.cor };
      });
      window.Graficos.desempenhoPorDisciplina(c2, dados);
    }
    const cTopicos = raiz.querySelector('#graf-topicos');
    if (cTopicos) {
      window.Graficos.topicosDesempenho(cTopicos, dadosTopicosDesempenho(statsTopicosFiltro));
    }
    const topDisc = raiz.querySelector('#stats-topicos-disc');
    const topOrdem = raiz.querySelector('#stats-topicos-ordem');
    const topLimite = raiz.querySelector('#stats-topicos-limite');
    // Ao trocar um filtro, redesenha SÓ o gráfico de "Tópicos × desempenho"
    // (os demais gráficos e KPIs não dependem desses filtros), evitando recarregar
    // a tela inteira a cada seleção.
    [topDisc, topOrdem, topLimite].forEach(function (el) {
      if (!el) return;
      el.addEventListener('change', function () {
        statsTopicosFiltro.disciplina = topDisc ? topDisc.value : '';
        statsTopicosFiltro.ordem = topOrdem ? topOrdem.value : 'piores';
        statsTopicosFiltro.limite = topLimite ? topLimite.value : '18';
        const dados = dadosTopicosDesempenho(statsTopicosFiltro);
        const corpo = raiz.querySelector('#stats-topicos-corpo');
        const statsMobileAgora = window.matchMedia && window.matchMedia('(max-width: 560px)').matches;
        if (statsMobileAgora && corpo) {
          corpo.innerHTML = topicosDesempenhoMobileHtml(dados);
          return;
        }
        const canvas = raiz.querySelector('#graf-topicos');
        if (!canvas) return;
        const box = canvas.closest('.grafico-box');
        if (box) box.style.height = (statsMobileAgora ? 360 : Math.max(280, Math.min(640, dados.length * 38 + 86))) + 'px';
        window.Graficos.topicosDesempenho(canvas, dados);
      });
    });
  }

  // ---------------- TELA: Disciplina detalhada ----------------
  function sessoesDaDisciplina(disciplina) {
    const ids = new Set(disciplina.topicos.map(function (t) { return t.id; }));
    return D.sessoesDoPlano(state).filter(function (s) { return ids.has(s.topicoId); })
      .sort(function (a, b) { return b.data.localeCompare(a.data) || b.id.localeCompare(a.id); });
  }

  function metricasDisciplina(disciplina) {
    const sessoes = sessoesDaDisciplina(disciplina);
    let minutos = 0, feitas = 0, certas = 0;
    sessoes.forEach(function (s) {
      minutos += s.duracaoMin || 0;
      feitas += s.qFeitas || 0;
      certas += s.qCertas || 0;
    });
    const progresso = D.progressoDisciplina(disciplina);
    return {
      sessoes: sessoes,
      minutos: minutos,
      feitas: feitas,
      certas: certas,
      erros: Math.max(0, feitas - certas),
      desempenho: feitas > 0 ? Math.round((certas / feitas) * 100) : null,
      progresso: progresso
    };
  }

  function telaDisciplinaDetalhe() {
    const disc = D.disciplinaPorId(state, disciplinaDetalheId) || state.disciplinas.find(function (d) { return d.id !== 'ORF'; });
    if (!disc) {
      return '<h1>Disciplina</h1><div class="card"><div class="estado-vazio"><span class="bolha bolha-pendente"></span><strong>Nenhuma disciplina</strong>Crie ou importe um plano para ver os detalhes.</div></div>';
    }
    disciplinaDetalheId = disc.id;
    const m = metricasDisciplina(disc);
    const metaPct = state.plano && state.plano.meta ? state.plano.meta.corte_pct : 70;
    let html = '<button class="det-voltar-flutuante" id="det-voltar" aria-label="Voltar"><span aria-hidden="true">←</span><span class="det-voltar-txt">Voltar</span></button>';
    html += '<div class="cab-pagina detalhe-disc-cab"><div><span class="rotulo-pagina">' + esc(state.plano ? state.plano.concurso : 'Plano manual') + '</span>' +
      '<h1>' + esc(nomeDiscCurto(disc.nome)) + '</h1></div></div>';

    html += '<div class="linha-cards detalhe-metricas">' +
      '<div class="card card-kpi detalhe-card-tempo"><div class="card-kpi-rotulo">Tempo de estudo</div><div class="card-kpi-valor">' + D.formatarMin(m.minutos) + '</div></div>' +
      '<div class="card card-kpi detalhe-card-desempenho"><div class="card-kpi-rotulo">Desempenho</div><div class="detalhe-card-pizza">' + pizzaAcertosHtml(m.certas, m.erros, { titulo: disc.nome }) + '</div><div class="card-kpi-extra"><span class="painel-acertos">' + m.certas + ' acertos</span> · <span class="painel-erros">' + m.erros + ' erros</span></div></div>' +
      '<div class="card card-kpi detalhe-card-progresso"><div class="card-kpi-rotulo">Progresso no edital</div><div class="card-kpi-extra">' + m.progresso.concluidos + ' tópicos concluídos<br>' + (m.progresso.total - m.progresso.concluidos) + ' pendentes</div><div class="card-kpi-valor">' + m.progresso.pct + '%</div></div>' +
      '<div class="card card-kpi detalhe-card-questoes"><div class="card-kpi-rotulo">Questões</div><div class="card-kpi-valor">' + m.feitas + '</div><div class="card-kpi-extra">meta de corte: ' + metaPct + '%</div></div>' +
      '</div>';

    html += '<div class="card"><div class="card-cab-acao"><div class="card-kpi-rotulo">Histórico de registros</div>' +
      '<button class="botao-mini" id="det-add">+ Adicionar estudo</button></div>';
    if (m.sessoes.length === 0) {
      html += '<div class="estado-vazio" style="padding:1.5rem"><span class="bolha bolha-pendente"></span><strong>Sem registros nesta disciplina</strong>Use o botão Adicionar estudo para começar.</div>';
    } else {
      const HIST_LIMITE = 5;
      html += '<div class="painel-scroll"><table class="hist-tabela hist-colapsada"><thead><tr><th>Data</th><th>Categoria</th><th class="num">Tempo</th><th class="num">✓</th><th class="num">×</th><th class="num">%</th><th>Tópico</th></tr></thead><tbody>' +
        m.sessoes.map(function (s, i) {
          const t = D.topicoPorId(state, s.topicoId);
          const pct = s.qFeitas > 0 ? Math.round((s.qCertas / s.qFeitas) * 100) : null;
          return '<tr' + (i >= HIST_LIMITE ? ' class="hist-linha-extra"' : '') + '><td class="num">' + D.formatarDataBR(s.data) + '</td><td><span class="etiqueta etiqueta-bloco">' + esc(String(s.tipo || '').toUpperCase()) + '</span></td>' +
            '<td class="num">' + D.formatarMin(s.duracaoMin || 0) + '</td><td class="num painel-acertos">' + (s.qCertas || 0) + '</td>' +
            '<td class="num painel-erros">' + Math.max(0, (s.qFeitas || 0) - (s.qCertas || 0)) + '</td>' +
            '<td class="num">' + (pct === null ? '0' : pct) + '</td><td>' + esc(t ? t.nome : s.topicoId) + '</td></tr>';
        }).join('') +
        '</tbody></table></div>';
      if (m.sessoes.length > HIST_LIMITE) {
        html += '<button type="button" class="botao-mini botao-quieto hist-mais" id="det-hist-mais" data-expandido="0">Mostrar mais (' + (m.sessoes.length - HIST_LIMITE) + ')</button>';
      }
    }
    html += '</div>';

    html += '<div class="card edital-disc-card"><div class="card-kpi-rotulo">Edital verticalizado</div>' +
      '<div class="painel-scroll"><table><thead><tr><th>Tópicos</th><th class="num edital-qtd-col">Questões</th><th class="num edital-rend-col" title="Passe o mouse no rendimento para ver acertos e erros">Rendimento</th><th class="num">Incid.</th></tr></thead><tbody>' +
      (function () { const quentes = idsTopicosQuentes(disc.topicos); return disc.topicos.filter(function (t) { return !t.orfao; }).map(function (t) {
        const dt = D.desempenhoTopico(D.sessoesDoPlano(state), t.id);
        const feito = t.status === 'teoria_concluida' || t.status === 'dominado';
        // "em curso": tem estudo registrado (sessão) mas a teoria não foi concluída.
        // Mostra um ponto preenchido — feedback visual de que a sessão FOI registrada,
        // sem alegar conclusão (que é a ação separada da caixinha/✓ verde).
        const emCurso = !feito && t.status === 'em_curso';
        const classeCheck = feito ? 'check-estudo-feito' : (emCurso ? 'check-estudo-curso' : '');
        const tituloCheck = feito ? 'Teoria concluída (clique para reabrir)'
          : (emCurso ? 'Estudado — clique para marcar teoria concluída' : 'Marcar teoria concluída');
        const erros = Math.max(0, dt.feitas - dt.certas);
        return '<tr data-topico-detalhe="' + esc(t.id) + '" role="button" tabindex="0">' +
          '<td><span class="topico-check-wrap"><button type="button" class="check-estudo ' + classeCheck + '" data-topico-check="' + esc(t.id) + '" title="' + esc(tituloCheck) + '" aria-label="' + esc(tituloCheck + ': ' + t.nome) + '">' + (feito ? '✓' : '') + '</button><span>' + esc(t.nome) + '</span></span></td>' +
          '<td class="num edital-qtd-col">' + dt.feitas + '</td><td class="num edital-rend-col">' + pizzaAcertosHtml(dt.certas, erros, { classe: 'pizza-xs', titulo: t.nome }) + '</td>' +
          '<td class="num">' + tagIncidenciaHtml(t.incidencia_pct || 0, quentes.has(t.id)) + '</td></tr>';
      }).join(''); })() + '</tbody></table></div></div>';
    return html;
  }

  function ligarDisciplinaDetalhe(raiz) {
    const voltar = raiz.querySelector('#det-voltar');
    if (voltar) voltar.addEventListener('click', function () { location.hash = '#hoje'; });
    const add = raiz.querySelector('#det-add');
    if (add) add.addEventListener('click', function () {
      const disc = D.disciplinaPorId(state, disciplinaDetalheId);
      const topico = disc && disc.topicos.find(function (t) { return !t.orfao; });
      abrirRegistro({ topicoId: topico ? topico.id : null });
    });
    const histMais = raiz.querySelector('#det-hist-mais');
    if (histMais) histMais.addEventListener('click', function () {
      const tabela = raiz.querySelector('.hist-tabela');
      if (!tabela) return;
      const expandido = histMais.getAttribute('data-expandido') === '1';
      tabela.classList.toggle('hist-colapsada', expandido);
      histMais.setAttribute('data-expandido', expandido ? '0' : '1');
      const extras = tabela.querySelectorAll('.hist-linha-extra').length;
      histMais.textContent = expandido ? 'Mostrar mais (' + extras + ')' : 'Mostrar menos';
    });
    raiz.querySelectorAll('[data-topico-check]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        const t = D.topicoPorId(state, b.getAttribute('data-topico-check'));
        if (!t) return;
        const feito = t.status === 'teoria_concluida' || t.status === 'dominado';
        if (feito) {
          t.status = 'em_curso';
          // Reabrir desfaz a conclusão: as revisões que tinham sido agendadas ao
          // concluir (e ainda não feitas) são eliminadas — senão ficavam órfãs no
          // calendário mesmo depois de tirar o "concluído".
          removerRevisoesPendentes(t.id);
          salvar(); render();
          toast('Tópico reaberto — revisões agendadas removidas', 'sucesso');
        } else {
          const registrouTempo = concluirTopicoTeoria(t.id);
          render();
          toast(registrouTempo ? 'Tópico concluído — estudo de hoje registrado ✓' : 'Tópico concluído', 'sucesso');
        }
      });
    });
    raiz.querySelectorAll('[data-topico-detalhe]').forEach(function (linha) {
      const abrir = function () { abrirTopico(linha.getAttribute('data-topico-detalhe')); };
      linha.addEventListener('click', abrir);
      linha.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
    });
  }

  // ---------------- TELA: Histórico ----------------
  let historicoLimite = 50;
  let historicoEscopo = 'plano'; // 'plano' = só o plano ativo | 'site' = tudo registrado no site

  // procura o tópico em todos os planos (para o histórico do site inteiro)
  function infoTopicoGlobal(topicoId) {
    for (let i = 0; i < state.planos.length; i++) {
      const p = state.planos[i];
      for (let j = 0; j < p.disciplinas.length; j++) {
        const d = p.disciplinas[j];
        const t = d.topicos.find(function (x) { return x.id === topicoId; });
        if (t) return { topico: t, disciplina: d, entrada: p };
      }
    }
    return null;
  }

  function nomePlanoDaSessao(s) {
    const id = s.planoId || state.planoAtivoId;
    const p = state.planos.find(function (x) { return x.id === id; });
    return p ? p.plano.concurso : 'Plano removido';
  }

  function telaHistorico() {
    const doSite = historicoEscopo === 'site';
    const lista = doSite ? state.sessoes : D.sessoesDoPlano(state);
    let html = '<div class="cab-pagina"><div><h1>Histórico</h1><p class="sub">' +
      lista.length + (doSite ? ' sessões em todo o site' : ' sessões deste plano') + '</p></div>' +
      '<div class="cab-acoes">' +
      '<button class="botao-mini ' + (doSite ? 'botao-quieto' : '') + '" data-hist-escopo="plano">Plano de estudos</button>' +
      '<button class="botao-mini ' + (doSite ? '' : 'botao-quieto') + '" data-hist-escopo="site">Site inteiro</button>' +
      '</div></div>';
    if (lista.length === 0) {
      return html + '<div class="card"><div class="estado-vazio">' +
        '<span class="bolha bolha-pendente"></span><strong>Nenhuma sessão registrada' + (doSite ? '' : ' neste plano') + '</strong>' +
        'Cada sessão registrada (timer ou manual) aparece aqui.</div></div>';
    }
    const ordenadas = [...lista].sort(function (a, b) { return b.data.localeCompare(a.data) || b.id.localeCompare(a.id); });
    const visiveis = ordenadas.slice(0, historicoLimite);
    html += '<div class="card" style="overflow-x:auto"><table><thead><tr>' +
      '<th>Data</th><th>Tópico</th>' + (doSite ? '<th>Plano</th>' : '') + '<th>Tipo</th><th class="num">Tempo</th><th class="num">Questões</th><th></th></tr></thead><tbody>';
    visiveis.forEach(function (s) {
      let d = D.disciplinaDoTopico(state, s.topicoId);
      let t = D.topicoPorId(state, s.topicoId);
      if (doSite && (!d || !t)) {
        const info = infoTopicoGlobal(s.topicoId);
        if (info) { d = info.disciplina; t = info.topico; }
      }
      html += '<tr><td class="num" style="white-space:nowrap">' + D.formatarDataBR(s.data) + '</td>' +
        '<td>' + (d ? tagDisc(d) + ' ' : '') + esc(t ? t.nome : s.topicoId) + (s.obs ? '<div style="font-size:0.75rem;color:var(--grafite)">' + esc(s.obs) + '</div>' : '') + '</td>' +
        (doSite ? '<td style="font-size:0.8rem">' + esc(nomePlanoDaSessao(s)) + '</td>' : '') +
        '<td>' + esc(s.tipo) + '</td>' +
        '<td class="num">' + D.formatarMin(s.duracaoMin || 0) + '</td>' +
        '<td class="num">' + (s.qFeitas > 0 ? s.qCertas + '/' + s.qFeitas : '—') + '</td>' +
        '<td><button class="botao-mini botao-quieto" data-excluir="' + esc(s.id) + '" title="Excluir sessão">✕</button></td></tr>';
    });
    html += '</tbody></table>';
    if (ordenadas.length > historicoLimite) {
      html += '<p style="text-align:center;margin-top:0.75rem"><button class="botao-quieto" id="hist-mais">Mostrar mais (' + (ordenadas.length - historicoLimite) + ' restantes)</button></p>';
    }
    html += '</div>';
    return html;
  }

  function ligarHistorico(raiz) {
    raiz.querySelectorAll('[data-hist-escopo]').forEach(function (b) {
      b.addEventListener('click', function () {
        historicoEscopo = b.getAttribute('data-hist-escopo');
        historicoLimite = 50;
        render();
      });
    });
    const mais = raiz.querySelector('#hist-mais');
    if (mais) mais.addEventListener('click', function () { historicoLimite += 50; render(); });
    raiz.querySelectorAll('[data-excluir]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = b.getAttribute('data-excluir');
        confirmar({ titulo: 'Excluir sessão?', mensagem: 'Os percentuais de desempenho serão recalculados.', confirmar: 'Excluir', perigo: true, icone: '🗑️' }).then(function (ok) {
          if (!ok) return;
          state.sessoes = state.sessoes.filter(function (s) { return s.id !== id; });
          window.Store.marcarRemovido(state, id); // não deixa o sync ressuscitar
          salvar(); render();
          toast('Sessão excluída');
        });
      });
    });
  }

  // ---------------- TELA: Configurações (F2) ----------------
  function telaAjustes() {
    // Esta aba foca no painel do edital. Nome do usuário fica no Perfil (topo);
    // meta de questões da semana é editada na Hoje; o ritmo do cronograma é
    // definido ao criar o plano (aba Planos), após escolher o edital.
    const u = usuarioAtual();
    let html = '<h1 class="sr-only">Configurações</h1>';
    if (usuarioAdmin()) {
      html += editaisEsquematizadosHtml();
    } else {
      html += '<div class="card"><h3>Minha conta</h3>' +
        '<p class="sub">Você está logado como <strong>' + esc(u && u.email ? u.email : 'usuário') + '</strong>.</p>' +
        '<p class="sub">Seu perfil tem acesso ao catálogo global e pode gerar planos próprios. O painel administrativo fica restrito ao administrador.</p></div>';
      html += planosBaseConfiguracaoHtml();
    }

    html += carreirasConfiguracaoHtml();

    html += '<div class="ajustes-sync-grid">';

    const syncAtual = statusSincronizacao();
    const syncTexto = syncAtual && syncAtual.texto ? syncAtual.texto : 'Verificando sincronização';
    const syncFonte = syncAtual && syncAtual.fonte ? syncAtual.fonte : (syncStatus && syncStatus.endpoint ? syncStatus.endpoint : 'servidor local não detectado');
    const contaSync = firebaseStatus && firebaseStatus.usuario && firebaseStatus.usuario.email
      ? '<p style="font-size:0.78rem;color:var(--grafite)">Conta: <strong id="sync-conta">' + esc(firebaseStatus.usuario.email) + '</strong></p>'
      : '<p style="font-size:0.78rem;color:var(--grafite)">Conta: <strong id="sync-conta">não conectada</strong></p>';
    html += '<div class="card"><h3>Sincronização entre aparelhos</h3>' +
      '<p style="font-size:0.88rem;color:var(--grafite)">Status: <strong id="sync-status">' + esc(syncTexto) + '</strong></p>' +
      '<p style="font-size:0.78rem;color:var(--grafite)">Fonte: <span id="sync-endpoint">' + esc(syncFonte) + '</span></p>' +
      contaSync +
      '<div class="modal-acoes" style="justify-content:flex-start">' +
      '<button id="fb-login">Entrar com Google</button>' +
      '<button class="botao-secundario" id="sync-agora">Sincronizar agora</button>' +
      '<button class="botao-secundario" id="fb-backups">Backups na nuvem</button>' +
      '<button class="botao-quieto" id="fb-logout">Sair</button>' +
      '</div></div>';

    html += '</div>'; // .ajustes-sync-grid

    html += '<div class="card"><h3>Backup manual</h3>' +
      '<p class="sub">Baixe uma cópia completa em JSON. Ela funciona mesmo sem Firebase e pode restaurar seus planos e registros neste ou em outro aparelho.</p>' +
      '<div class="modal-acoes" style="justify-content:flex-start">' +
      '<button class="botao-secundario" id="backup-exportar"' + (modoDemo ? ' disabled' : '') + '>Baixar backup (.json)</button>' +
      '<button class="botao-quieto" id="backup-importar"' + (modoDemo ? ' disabled' : '') + '>Restaurar backup</button>' +
      '<input id="backup-arquivo" class="oculto" type="file" accept=".json,application/json">' +
      '</div>' + (modoDemo ? '<p class="sub">Saia do modo exemplo para usar backups dos seus dados reais.</p>' : '') + '</div>';

    // Recuperação de dados: registros de estudo de planos excluídos continuam
    // salvos (excluirPlano preserva sessões/simulados), mas ficam invisíveis
    // porque as telas filtram pelo plano ativo. Este card os traz de volta, e
    // permite recriar um plano combinado a partir do edital-artefato guardado.
    const orfaos = registrosOrfaos();
    const editaisRec = editaisCombinadosSemPlano();
    if (orfaos.total > 0 || editaisRec.length > 0) {
      html += '<div class="card"><h3>🩹 Recuperação de dados</h3>';
      if (editaisRec.length > 0) {
        html += '<p class="sub">O edital de um plano combinado excluído ainda está guardado. Dá para recriar o plano a partir dele:</p>';
        editaisRec.forEach(function (e) {
          html += '<div class="modal-acoes" style="justify-content:flex-start;margin-bottom:0.4rem">' +
            '<button class="botao-secundario botao-mini" data-rec-edital="' + esc(e.id) + '">Recriar plano «' + esc(e.titulo || 'combinado') + '»</button></div>';
        });
      }
      if (orfaos.total > 0) {
        html += '<p class="sub">Há <strong>' + orfaos.total + '</strong> registro(s) de estudo (sessões, revisões, simulados, blocos de agenda ou flashcards) de plano(s) excluído(s). Eles continuam salvos — só não aparecem. Você pode trazê-los para o plano ativo.</p>' +
          '<button class="botao-mini" id="rec-orfaos"' + (state.planoAtivoId ? '' : ' disabled') + '>Trazer para o plano ativo</button>' +
          (state.planoAtivoId ? '' : '<p class="sub">Crie ou recrie um plano primeiro para poder vinculá-los.</p>');
      }
      html += '</div>';
    }

    html += '<div class="card card-quieto"><h3 style="color:var(--errado)">Zona de risco</h3>' +
      '<p class="sub">Apaga seus planos, sessões, revisões, simulados e agenda para recomeçar do zero. O catálogo de editais e suas configurações são mantidos.</p>' +
      '<button class="botao-perigo botao-mini" id="zr-limpar">Apagar meus dados de estudo</button></div>';
    return html;
  }

  // ---------------- Editais esquematizados (base para planos personalizados) ----------------
  function contarTopicosEdital(e) {
    return (e.disciplinas || []).reduce(function (n, d) { return n + (d.topicos || []).length; }, 0);
  }

  // ---- metadados de catálogo (campos opcionais, retrocompatíveis) ----
  const NIVEIS_EDITAL = {
    fundamental: 'Ensino fundamental',
    medio: 'Ensino médio',
    tecnico: 'Nível médio técnico',
    superior: 'Ensino superior',
    facil: 'Ensino médio',
    dificil: 'Ensino superior'
  };
  function nivelEdital(e) { return e && e.nivel && NIVEIS_EDITAL[e.nivel] ? e.nivel : 'medio'; }
  function horasEsforcoEdital(e) { return Math.round(D.totalHorasTeoria((e && e.disciplinas) || []) * 1.8); }
  function tempoMedioMesesEdital(e) { return Math.max(1, Math.round(horasEsforcoEdital(e) / (12 * 4.345))); }
  function janelaProvaTexto(e) {
    if (e && e.janelaProva && e.janelaProva.inicio) {
      const ini = D.formatarMesBR(e.janelaProva.inicio);
      const fim = e.janelaProva.fim ? D.formatarMesBR(e.janelaProva.fim) : null;
      return fim && fim !== ini ? ini + ' a ' + fim : ini;
    }
    return 'a definir';
  }
  function horasSemanaDisponiveis() {
    try {
      const min = totalMinutosRotina(rotinaEstudosAtual());
      if (min > 0) return Math.round(min / 60);
    } catch (e) { /* rotina indisponível */ }
    return 18;
  }

  function comparacaoPrecisaHorasManuais() {
    return (!state.planos || state.planos.length === 0) &&
      !(state.config && state.config.rotinaEstudos && state.config.rotinaEstudos.dias);
  }

  // Resumo compacto das notas de corte por modalidade para os cards do admin.
  function cortesResumoEdital(e) {
    if (e && e.metaDesempenho) return 'meta ' + (e.notaCorte || 80) + '%';
    const c = e.cortes || {};
    const ampla = c.ampla != null ? c.ampla : (e.notaCorte != null ? e.notaCorte : null);
    const partes = [];
    if (ampla != null) partes.push('Ampla ' + ampla + '%');
    if (c.negros != null) partes.push('CN ' + c.negros + '%');
    if (c.pcd != null) partes.push('PcD ' + c.pcd + '%');
    return partes.length ? 'corte ' + partes.join(' · ') : 'corte ~' + (e.notaCorte || 70) + '%';
  }

  function adminEditalCard(e, arquivado) {
    const global = !!e._global;
    const base = !!e._base;
    const podeExcluir = !base;
    return '<div class="plano-mini">' +
      '<div class="plano-mini-top">' +
      '<div class="plano-mini-tit"><strong>' + esc(e.titulo) + '</strong>' +
      (e.emAlta ? ' <span class="etiqueta etiqueta-alta">em alta</span>' : '') +
      (global ? ' <span class="etiqueta">global</span>' : (base ? ' <span class="etiqueta">modelo</span>' : '')) + '</div></div>' +
      '<p class="sub">' + esc(e.banca || 'banca não informada') + ' · ' + (e.disciplinas || []).length + ' disc · ' +
      contarTopicosEdital(e) + ' tóp · ' + cortesResumoEdital(e) + ' · ' + esc(NIVEIS_EDITAL[nivelEdital(e)]) + '</p>' +
      '<div class="compact-actions">' +
      '<button class="botao-mini botao-secundario" data-ed-plano="' + esc(e.id) + '">Criar plano</button>' +
      '<button class="botao-mini" data-ed-editar="' + esc(e.id) + '">' + (global || base ? 'Personalizar' : 'Editar') + '</button>' +
      (podeExcluir ? '<button class="botao-mini botao-quieto" data-ed-excluir="' + esc(e.id) + '">Excluir</button>' : '') + '</div></div>';
  }

  function pedidosEditalHtml() {
    const pedidos = adminPedidosGlobais || state.config.pedidosEdital || [];
    let h = '<div class="admin-pedidos"><strong style="font-size:0.9rem">Pedidos de edital recebidos</strong>' +
      '<p class="sub">Registre aqui os pedidos que chegarem por e-mail e marque quando atender.</p>';
    if (pedidos.length) {
      h += '<ul class="pedidos-lista">' + pedidos.map(function (p) {
        return '<li><span>' + esc(p.texto) + '</span><button class="botao-mini botao-quieto" data-pedido-ok="' + esc(p.id) + '">Atendido</button></li>';
      }).join('') + '</ul>';
    } else {
      h += '<p class="sub">Nenhum pedido pendente.</p>';
    }
    h += '<div class="grade-2" style="margin-top:0.4rem">' +
      '<input id="adm-pedido-txt" type="text" placeholder="Ex.: TJSP Escrevente 2026 (pedido do João)">' +
      '<button class="botao-secundario botao-mini" id="adm-pedido-add">Adicionar pedido</button></div></div>';
    return h;
  }

  // Formulário de importação (usado dentro do modal "Importar arquivo")
  function importarEditalFormHtml() {
    return '<p class="sub">Importe o JSON da skill/IA ou uma planilha. Antes de salvar você confere e ajusta tudo.</p>' +
      '<div class="grade-2" style="margin-top:0.4rem">' +
      '<div><label for="ed-titulo">Nome do edital</label><input id="ed-titulo" type="text" placeholder="Ex.: TRF3 Técnico Judiciário 2026"></div>' +
      '<div><label for="ed-banca">Banca</label><input id="ed-banca" type="text" placeholder="Ex.: FCC"></div></div>' +
      '<div class="grade-3">' +
      '<div><label for="ed-orgao">Órgão</label><input id="ed-orgao" type="text" placeholder="Ex.: TRF 3ª Região"></div>' +
      '<div><label for="ed-cargo">Cargo</label><input id="ed-cargo" type="text" placeholder="Ex.: Técnico Judiciário"></div>' +
      '<div><label for="ed-estado">Estado (UF)</label><input id="ed-estado" type="text" maxlength="2" placeholder="Ex.: SP" style="text-transform:uppercase"></div></div>' +
      '<label for="ed-corte">Nota de corte estimada (%)</label>' +
      '<input id="ed-corte" type="number" min="0" max="100" value="70" style="max-width:160px">' +
      '<label for="ed-arquivo">Tópicos detalhados (arquivo .json, .xlsx ou .csv)</label>' +
      '<input type="file" id="ed-arquivo" accept=".json,.xlsx,.csv,application/json,text/csv">' +
      '<label for="ed-json">ou cole o JSON com as disciplinas</label>' +
      '<textarea id="ed-json" placeholder=\'{"disciplinas":[{"id":"POR","nome":"Português","topicos":[...]}]}\'></textarea>';
  }

  function abrirImportarEdital() {
    if (!usuarioAdmin()) { toast('Apenas o administrador pode importar editais.', 'erro'); return; }
    const m = abrirModal('<h3>Importar arquivo</h3>' + importarEditalFormHtml() +
      '<div class="modal-acoes"><button class="botao-quieto" id="ed-cancelar">Cancelar</button>' +
      '<button id="ed-cadastrar">Conferir importação</button></div>');
    m.classList.add('modal-amplo');
    m.querySelector('#ed-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#ed-cadastrar').addEventListener('click', function () { cadastrarEditalEsquematizado(m); });
  }

  function abrirListaPedidos() {
    if (!usuarioAdmin()) { toast('Apenas o administrador pode ver pedidos de edital.', 'erro'); return; }
    const m = abrirModal('<h3>Lista de pedidos</h3><div id="ped-corpo"></div>');
    function pintar() {
      m.querySelector('#ped-corpo').innerHTML = pedidosEditalHtml() +
        '<div class="modal-acoes"><button class="botao-quieto" id="ped-fechar">Fechar</button></div>';
      const add = m.querySelector('#adm-pedido-add');
      if (add) add.addEventListener('click', function () {
        const inp = m.querySelector('#adm-pedido-txt');
        const txt = ((inp && inp.value) || '').trim();
        if (!txt) { toast('Descreva o pedido.', 'erro'); return; }
        if (!Array.isArray(state.config.pedidosEdital)) state.config.pedidosEdital = [];
        state.config.pedidosEdital.push({ id: window.Store.novoId('ped'), texto: txt, em: D.hojeISO() });
        salvar(); pintar(); toast('Pedido registrado');
      });
      m.querySelectorAll('[data-pedido-ok]').forEach(function (b) {
        b.addEventListener('click', function () {
          const id = b.getAttribute('data-pedido-ok');
          if (window.FirebaseSync && window.FirebaseSync.marcarPedidoAtendido && adminPedidosGlobais) {
            window.FirebaseSync.marcarPedidoAtendido(id).then(function () {
              adminPedidosGlobais = adminPedidosGlobais.filter(function (p) { return p.id !== id; });
              pintar(); toast('Pedido marcado como atendido');
            }).catch(function () { toast('Não consegui atualizar o pedido.', 'erro'); });
            return;
          }
          state.config.pedidosEdital = (state.config.pedidosEdital || []).filter(function (p) { return p.id !== id; });
          salvar(); pintar(); toast('Pedido marcado como atendido');
        });
      });
      m.querySelector('#ped-fechar').addEventListener('click', fecharModal);
    }
    m.querySelector('#ped-corpo').innerHTML = '<p class="sub">Carregando pedidos...</p>';
    if (window.FirebaseSync && window.FirebaseSync.carregarPedidosEdital) {
      window.FirebaseSync.carregarPedidosEdital().then(function (pedidos) {
        adminPedidosGlobais = pedidos || [];
        pintar();
      }).catch(function () {
        adminPedidosGlobais = null;
        pintar();
        toast('Não consegui carregar os pedidos da nuvem.', 'erro');
      });
    } else {
      pintar();
    }
  }

  function editaisEsquematizadosHtml() {
    const termo = (adminBusca || '').trim().toLowerCase();
    const correspondeBusca = function (e) {
      if (!termo) return true;
      return [e.titulo, e.banca, e.orgao, e.cargo, e.estado].filter(Boolean)
        .join(' ').toLowerCase().indexOf(termo) >= 0;
    };
    const listaCatalogo = editaisDoCatalogoAdmin();
    const ativos = listaCatalogo.filter(function (e) { return !e.arquivado && correspondeBusca(e); });
    const arquivados = listaCatalogo.filter(function (e) { return e.arquivado && correspondeBusca(e); });

    let html = '<div class="card"><h3 class="planos-cad-titulo">Planos cadastrados</h3>' +
      '<div class="planos-cad-barra">' +
      '<input id="adm-busca" class="campo-busca-compacto" type="search" placeholder="Buscar por órgão, cargo, estado…" value="' + esc(adminBusca || '') + '">' +
      '<div class="planos-cad-acoes">' +
      '<button class="botao botao-mini" id="adm-novo">+ Novo edital</button>' +
      '<button class="botao-secundario botao-mini" id="adm-importar">Importar arquivo</button>' +
      '<button class="botao-quieto botao-mini" id="adm-pedidos">Lista de pedidos</button>' +
      '</div></div>';

    if (catalogoPublicacaoErro) {
      html += '<div class="aviso aviso-erro" style="margin-top:0.65rem">' + esc(catalogoPublicacaoErro) + '</div>';
    } else if (catalogoPublicacaoOkEm) {
      html += '<p class="sub" style="margin:0.55rem 0 0">Catálogo global publicado. Outras contas já podem carregar estes planos.</p>';
    } else {
      html += '<p class="sub" style="margin:0.55rem 0 0">O catálogo global é publicado automaticamente sempre que você cadastra, edita ou exclui um edital.</p>';
    }

    if (ativos.length > 0) {
      html += '<div class="planos-grade">';
      ativos.forEach(function (e) { html += adminEditalCard(e, false); });
      html += '</div>';
    } else {
      html += '<p class="sub" style="margin:0.3rem 0">' + (termo ? 'Nenhum plano encontrado para essa busca.' : 'Nenhum edital cadastrado ainda.') + '</p>';
    }

    if (arquivados.length > 0) {
      html += '<details style="margin-top:0.4rem"><summary style="cursor:pointer;font-weight:700;font-size:0.9rem">Arquivados (' + arquivados.length + ')</summary>' +
        '<div class="planos-grade" style="margin-top:0.5rem">';
      arquivados.forEach(function (e) { html += adminEditalCard(e, true); });
      html += '</div></details>';
    }

    html += '</div>';
    return html;
  }

  function carreiraConfiguracaoCard(c) {
    const admin = usuarioAdmin();
    const temBase = !!carreiraBasePorId(c.id);
    const personalizada = !!c._personalizada;
    const podeRemover = admin ? !!c._carreiraGlobal : !!c._carreiraPessoal;
    const restauraPlataforma = !admin && !!(c._carreiraPessoal && c._carreiraGlobal);
    const origem = personalizada
      ? (c._carreiraGlobal ? 'publicada para todos' : (temBase ? 'versão personalizada' : 'criada por você'))
      : 'modelo do Gabaritei OS';
    const acaoRemover = podeRemover
      ? '<button class="botao-mini botao-quieto" data-car-remover="' + esc(c.id) + '">' +
        (restauraPlataforma ? 'Restaurar versão da plataforma' : (temBase ? 'Restaurar original' : 'Excluir')) + '</button>'
      : '';
    return '<div class="carreira-config-item">' +
      '<div class="carreira-config-resumo">' + editalFotoHtml(c) +
      '<div><strong>' + esc(c.titulo) + '</strong>' +
      '<p class="sub">' + esc(origem) + ' · ' + (c.disciplinas || []).length + ' disciplinas · ' +
      contarTopicosEdital(c) + ' tópicos</p></div></div>' +
      '<div class="compact-actions">' +
      '<button class="botao-mini" data-car-editar="' + esc(c.id) + '">Editar</button>' +
      '<button class="botao-mini botao-secundario" data-car-ver="' + esc(c.id) + '">Ver em Planos</button>' +
      acaoRemover + '</div></div>';
  }

  function carreirasConfiguracaoHtml() {
    const lista = carreirasDoCatalogo();
    const admin = usuarioAdmin();
    return '<div class="card carreiras-config-card">' +
      '<div class="carreiras-config-cab"><div><span class="rotulo-pagina">' + (admin ? 'Catálogo da plataforma' : 'Catálogo pessoal') + '</span>' +
      '<h3>Planos de carreira</h3></div>' +
      '<button class="botao botao-mini" id="car-nova">+ Nova carreira</button></div>' +
      '<p class="sub">' + (admin
        ? 'Edite os modelos de carreira ou crie outro do zero. Ao salvar, o catálogo é publicado para todos os alunos.'
        : 'Edite qualquer modelo de carreira para adaptar matérias, prioridades, ordem, carga e capa ao seu método. Você também pode criar outra carreira do zero. As alterações ficam na sua conta e não mudam os modelos dos demais alunos.') + '</p>' +
      '<div class="carreiras-config-lista">' +
      (lista.length ? lista.map(carreiraConfiguracaoCard).join('') : '<p class="sub">Nenhuma carreira disponível.</p>') +
      '</div></div>';
  }

  function planosBaseConfiguracaoHtml() {
    const idsBase = {};
    catalogoEditaisBase.forEach(function (e) { idsBase[e.id] = true; });
    const personalizados = (state.editais || []).filter(function (e) { return idsBase[e.id] && !ehItemCarreira(e); });
    const lista = catalogoEditaisBase.map(function (base) {
      return personalizados.find(function (e) { return e.id === base.id; }) || base;
    });
    if (!lista.length) return '';
    return '<div class="card carreiras-config-card">' +
      '<div class="carreiras-config-cab"><div><span class="rotulo-pagina">Catálogo pessoal</span>' +
      '<h3>Planos específicos</h3></div></div>' +
      '<p class="sub">Personalize os modelos de concurso sem transformar o conteúdo em uma carreira. As alterações ficam na sua conta.</p>' +
      '<div class="carreiras-config-lista">' + lista.map(function (e) {
        const personalizado = personalizados.some(function (p) { return p.id === e.id; });
        return '<div class="carreira-config-item"><div class="carreira-config-resumo">' + editalFotoHtml(e) +
          '<div><strong>' + esc(e.titulo) + '</strong><p class="sub">' +
          (personalizado ? 'versão personalizada' : 'modelo do Gabaritei OS') + ' · ' +
          (e.disciplinas || []).length + ' disciplinas · ' + contarTopicosEdital(e) + ' tópicos</p></div></div>' +
          '<div class="compact-actions"><button class="botao-mini" data-base-editar="' + esc(e.id) + '">Editar</button>' +
          '<button class="botao-mini botao-secundario" data-base-ver="' + esc(e.id) + '">Ver em Planos</button>' +
          (personalizado ? '<button class="botao-mini botao-quieto" data-base-restaurar="' + esc(e.id) + '">Restaurar original</button>' : '') +
          '</div></div>';
      }).join('') + '</div></div>';
  }

  // aceita o contrato completo ({disciplinas:[...]}), uma lista de disciplinas ou linhas de planilha
  function disciplinasDeEntradaEdital(json, titulo) {
    if (Array.isArray(json)) {
      if (json.length > 0 && json[0] && json[0].topicos) return json;          // lista de disciplinas
      return planoJsonDeLinhas(json, titulo).disciplinas;                       // linhas de planilha
    }
    if (json && Array.isArray(json.disciplinas)) return json.disciplinas;
    return [];
  }

  // Lê as notas de corte por modalidade (ampla/negros/pcd) do JSON da skill.
  // Aceita um objeto limpo {ampla,negros,pcd} ou o bloco "notas_corte_ultimo_nomeado"
  // (escolhe a unidade de maior corte de ampla — a mais concorrida, meta recomendada).
  function cortesDeJson(json) {
    const pct = function (v) { const n = parseFloat(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null; };
    const limpo = json.notas_corte || json.cortes || null;
    if (limpo && typeof limpo === 'object') {
      return { ampla: pct(limpo.ampla), negros: pct(limpo.negros != null ? limpo.negros : limpo.cn), pcd: pct(limpo.pcd) };
    }
    const blocos = json.notas_corte_ultimo_nomeado;
    if (blocos && typeof blocos === 'object') {
      let melhor = null;
      Object.keys(blocos).forEach(function (k) {
        const u = blocos[k];
        if (u && typeof u === 'object' && typeof u.ampla_pct === 'number' && (!melhor || u.ampla_pct > melhor.ampla_pct)) melhor = u;
      });
      if (melhor) return { ampla: pct(melhor.ampla_pct), negros: pct(melhor.cn_pct), pcd: pct(melhor.pcd_pct) };
    }
    return null;
  }

  // Extrai os metadados do JSON da skill para autopreencher o cadastro.
  function metadadosEditalDeJson(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
    const jp = json.janela_prova || json.janelaProva || {};
    const corte = json.nota_corte_sugerida_pct != null ? json.nota_corte_sugerida_pct
      : (json.notaCorte != null ? json.notaCorte : null);
    const cortesJson = cortesDeJson(json) || {};
    const amplaFinal = cortesJson.ampla != null ? cortesJson.ampla
      : (corte != null ? Math.max(0, Math.min(100, parseInt(corte, 10) || 0)) : null);
    return {
      cortes: {
        ampla: amplaFinal,
        negros: cortesJson.negros != null ? cortesJson.negros : null,
        pcd: cortesJson.pcd != null ? cortesJson.pcd : null
      },
      titulo: (json.titulo || '').toString().trim(),
      banca: (json.banca || '').toString().trim(),
      orgao: (json.orgao || json['órgão'] || '').toString().trim(),
      cargo: (json.cargo || '').toString().trim(),
      area: (json.area || json['área'] || '').toString().trim(),
      estado: (json.estado || json.uf || '').toString().trim().toUpperCase().slice(0, 2),
      nivel: (json.escolaridade || json.nivel_escolaridade || json.nivel || '').toString().trim(),
      notaCorte: amplaFinal != null ? amplaFinal : (corte != null ? Math.max(0, Math.min(100, parseInt(corte, 10) || 0)) : null),
      tipoCorte: 'ampla',
      janelaProva: { inicio: (jp.inicio || '').toString(), fim: (jp.fim || '').toString() },
      emAlta: !!(json.em_alta || json.emAlta),
      salario: (json.salario || json.remuneracao || '').toString().trim(),
      beneficios: (json.beneficios || '').toString().trim(),
      vagas: (json.vagas != null ? json.vagas : (json.vagas_ultimo_edital != null ? json.vagas_ultimo_edital : '')).toString().trim()
    };
  }

  async function cadastrarEditalEsquematizado(raiz) {
    if (!usuarioAdmin()) { toast('Apenas o administrador pode cadastrar editais.', 'erro'); return; }
    const tituloForm = (raiz.querySelector('#ed-titulo').value || '').trim();
    const bancaForm = (raiz.querySelector('#ed-banca').value || '').trim();
    const orgaoForm = (raiz.querySelector('#ed-orgao') ? raiz.querySelector('#ed-orgao').value : '').trim();
    const cargoForm = (raiz.querySelector('#ed-cargo') ? raiz.querySelector('#ed-cargo').value : '').trim();
    const estadoForm = (raiz.querySelector('#ed-estado') ? raiz.querySelector('#ed-estado').value : '').trim().toUpperCase().slice(0, 2);
    const corteForm = parseInt(raiz.querySelector('#ed-corte').value, 10);
    const arquivoEl = raiz.querySelector('#ed-arquivo');
    const file = arquivoEl && arquivoEl.files && arquivoEl.files[0];
    let disciplinas = [];
    let meta = {};                                       // metadados vindos do JSON da skill
    try {
      if (file && /\.xlsx$/i.test(file.name)) {
        if (!window.XLSX) { toast('Leitor de Excel indisponível. Salve como CSV ou JSON.', 'erro'); return; }
        const wb = window.XLSX.read(await lerArquivo(file, true), { type: 'array' });
        const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        disciplinas = planoJsonDeLinhas(rows, tituloForm).disciplinas;
      } else if (file && /\.csv$/i.test(file.name)) {
        disciplinas = planoJsonDeLinhas(parseCsv(await lerArquivo(file, false)), tituloForm).disciplinas;
      } else {
        const texto = file ? await lerArquivo(file, false) : (raiz.querySelector('#ed-json').value || '').trim();
        if (!texto) { toast('Envie um arquivo ou cole o JSON com as disciplinas.', 'erro'); return; }
        const json = JSON.parse(texto);
        meta = metadadosEditalDeJson(json);
        disciplinas = disciplinasDeEntradaEdital(json, tituloForm || meta.titulo);
      }
    } catch (e) {
      toast('Não consegui ler o edital: ' + e.message, 'erro');
      return;
    }
    // O que o usuário digitou no formulário tem prioridade; o JSON autopreenche o resto.
    const titulo = tituloForm || meta.titulo || '';
    if (!titulo) { toast('Dê um nome ao edital (ou inclua "titulo" no JSON).', 'erro'); return; }
    const banca = bancaForm || meta.banca || '';
    const orgao = orgaoForm || meta.orgao || '';
    const cargo = cargoForm || meta.cargo || '';
    const estado = estadoForm || meta.estado || '';
    const corte = Number.isFinite(corteForm) && corteForm !== 70 ? corteForm
      : (meta.notaCorte != null ? meta.notaCorte : (Number.isFinite(corteForm) ? corteForm : 70));
    const teste = { versao: 1, plano: { concurso: titulo, banca: banca, meta: { corte_pct: corte } }, disciplinas: disciplinas };
    const v = D.validarPlano(teste);
    if (!v.ok) { toast('Edital inválido: ' + v.erros[0], 'erro'); return; }
    // Fluxo de importação inteligente: abre a tela de conferência já autopreenchida.
    abrirEditorEdital(null, 'conferencia', {
      titulo: titulo, banca: banca, orgao: orgao, cargo: cargo, area: meta.area || '',
      estado: estado, nivel: meta.nivel || '', notaCorte: corte, tipoCorte: meta.tipoCorte || 'ampla',
      cortes: meta.cortes || { ampla: corte, negros: null, pcd: null },
      janelaProva: meta.janelaProva, emAlta: meta.emAlta,
      salario: meta.salario || '', beneficios: meta.beneficios || '', vagas: meta.vagas || '',
      disciplinas: disciplinas
    });
  }

  // gera um plano de estudos personalizado a partir de um edital cadastrado
  // Planos "de verdade" (não rascunhos abandonados pelo assistente).
  function planosReais() {
    return (state.planos || []).filter(function (p) { return p && p.plano && !p.plano.rascunho; });
  }

  // Ao trocar de plano, mostra quanto do histórico é semanticamente compatível e
  // deixa o aluno decidir. O padrão recomendado reaproveita sessões, questões,
  // simulados integralmente compatíveis e o status dos tópicos equivalentes.
  function escolherAproveitamentoPlano(atual, destino, mapa) {
    return new Promise(function (resolve) {
      const r = mapa.resumo;
      const topicosCompativeis = {};
      mapa.topicos.forEach(function (t) { topicosCompativeis[t.origemId] = true; });
      let sessoes = 0, questoes = 0, minutos = 0;
      (state.sessoes || []).forEach(function (s) {
        if (s.planoId !== atual.id || !topicosCompativeis[s.topicoId]) return;
        sessoes++;
        questoes += s.qFeitas || 0;
        minutos += s.duracaoMin || 0;
      });

      const fundo = document.createElement('div');
      fundo.className = 'modal-fundo modal-fundo-dialogo';
      fundo.innerHTML = '<div class="modal modal-dialogo troca-plano-dialogo" role="dialog" aria-modal="true" aria-labelledby="troca-plano-titulo">' +
        '<div class="dialogo-icone" aria-hidden="true">↗</div>' +
        '<h3 id="troca-plano-titulo">Levar seu progresso para o novo plano?</h3>' +
        '<p class="sub dialogo-msg">Encontramos conteúdo em comum entre <strong>' + esc(atual.plano.concurso) + '</strong> e <strong>' + esc(destino.titulo) + '</strong>.</p>' +
        '<div class="troca-plano-resumo">' +
        '<span><strong>' + r.disciplinasComuns + '</strong><small>disciplinas em comum</small></span>' +
        '<span><strong>' + r.topicosComuns + '</strong><small>tópicos equivalentes</small></span>' +
        '<span><strong>' + questoes + '</strong><small>questões reaproveitáveis</small></span>' +
        '<span><strong>' + D.formatarMin(minutos) + '</strong><small>de estudo compatível</small></span>' +
        '</div>' +
        '<div class="troca-plano-opcoes">' +
        '<button type="button" data-troca="reaproveitar"><strong>Reaproveitar meu progresso <span class="etiqueta">recomendado</span></strong>' +
        '<small>Leva ' + sessoes + ' sessões compatíveis, desempenho e tópicos já estudados. O calendário será recalculado.</small></button>' +
        '<button type="button" class="botao-quieto" data-troca="zerar"><strong>Começar o novo plano do zero</strong>' +
        '<small>Mantém as estatísticas antigas guardadas no histórico anterior, sem misturá-las ao novo plano.</small></button>' +
        '</div>' +
        '<button type="button" class="botao-quieto troca-plano-cancelar" data-troca="cancelar">Continuar no plano atual</button>' +
        '<p class="sub troca-plano-nota">A correspondência é feita por disciplina e tópico. Conteúdo sem equivalência não é transferido.</p>' +
        '</div>';
      document.body.appendChild(fundo);
      function fechar(valor) {
        document.removeEventListener('keydown', aoTecla);
        fundo.remove();
        resolve(valor);
      }
      function aoTecla(e) { if (e.key === 'Escape') fechar(null); }
      fundo.addEventListener('click', function (e) { if (e.target === fundo) fechar(null); });
      fundo.querySelectorAll('[data-troca]').forEach(function (b) {
        b.addEventListener('click', function () {
          const escolha = b.getAttribute('data-troca');
          fechar(escolha === 'cancelar' ? null : escolha);
        });
      });
      document.addEventListener('keydown', aoTecla);
      setTimeout(function () { fundo.querySelector('[data-troca="reaproveitar"]').focus(); }, 20);
    });
  }

  async function limitePlanoBloqueia(destino) {
    const reais = planosReais();
    if (reais.length === 0) return { permitido: true, troca: null };
    const atual = reais[0];
    const mapa = D.mapearAproveitamentoPlano(atual, destino);
    const escolha = await escolherAproveitamentoPlano(atual, destino, mapa);
    if (!escolha) return { permitido: false, troca: null };
    return {
      permitido: true,
      troca: { origemId: atual.id, modo: escolha, mapa: mapa }
    };
  }

  function aplicarAproveitamentoHistorico(troca, entradaNova) {
    const resumo = { sessoes: 0, questoes: 0, minutos: 0, simulados: 0, topicos: 0 };
    if (!troca || troca.modo !== 'reaproveitar' || !entradaNova) return resumo;
    const porTopico = {};
    const porDisciplina = {};
    troca.mapa.topicos.forEach(function (t) { porTopico[t.origemId] = t.destinoId; });
    troca.mapa.disciplinas.forEach(function (d) { porDisciplina[d.origemId] = d.destinoId; });

    (state.sessoes || []).forEach(function (s) {
      const destinoTopico = s.planoId === troca.origemId && porTopico[s.topicoId];
      if (!destinoTopico) return;
      s.planoId = entradaNova.id;
      s.topicoId = destinoTopico;
      s.migradoDePlanoId = troca.origemId;
      resumo.sessoes++;
      resumo.questoes += s.qFeitas || 0;
      resumo.minutos += s.duracaoMin || 0;
    });

    (state.simulados || []).forEach(function (simulado) {
      if (simulado.planoId !== troca.origemId || !(simulado.acertos || []).length) return;
      const todosCompativeis = simulado.acertos.every(function (a) { return !!porDisciplina[a.disciplinaId]; });
      if (!todosCompativeis) return;
      simulado.acertos.forEach(function (a) { a.disciplinaId = porDisciplina[a.disciplinaId]; });
      simulado.planoId = entradaNova.id;
      simulado.migradoDePlanoId = troca.origemId;
      resumo.simulados++;
    });

    const statusPeso = { pendente: 0, em_curso: 1, teoria_concluida: 2, dominado: 3 };
    const topicosOrigem = {};
    const planoOrigem = (state.planos || []).find(function (p) { return p.id === troca.origemId; });
    ((planoOrigem && planoOrigem.disciplinas) || []).forEach(function (d) {
      (d.topicos || []).forEach(function (t) { topicosOrigem[t.id] = t; });
    });
    troca.mapa.topicos.forEach(function (par) {
      const antigo = topicosOrigem[par.origemId];
      let novo = null;
      (entradaNova.disciplinas || []).some(function (d) {
        novo = (d.topicos || []).find(function (t) { return t.id === par.destinoId; }) || null;
        return !!novo;
      });
      if (!antigo || !novo) return;
      if ((statusPeso[antigo.status] || 0) > (statusPeso[novo.status] || 0)) novo.status = antigo.status;
      if (antigo.bagagem && !novo.bagagem) novo.bagagem = antigo.bagagem;
      if (antigo.reaberto) novo.reaberto = true;
      if (antigo.status !== 'pendente' || antigo.bagagem) resumo.topicos++;
    });
    return resumo;
  }

  function finalizarTrocaPlano(troca, entradaNova) {
    if (!troca || !entradaNova) return null;
    const resumo = aplicarAproveitamentoHistorico(troca, entradaNova);
    excluirEventosPlanoGoogleCalendar(troca.origemId).catch(function () {
      console.warn('Não consegui limpar todos os eventos do plano anterior no Google Calendar.');
    });
    limparDadosVinculados(troca.origemId);
    window.Store.removerPlano(state, troca.origemId);
    window.Store.ativarPlano(state, entradaNova.id);
    sanearTimerOrfao({ forcar: true });
    if (!state.config.planosExcluidos || typeof state.config.planosExcluidos !== 'object') state.config.planosExcluidos = {};
    state.config.planosExcluidos[troca.origemId] = new Date().toISOString();
    if (state.config) delete state.config.apagadoEm;
    editalAbertas = new Set();
    salvar();
    return resumo;
  }

  async function criarPlanoDeEdital(editalId) {
    const e = editalPorId(editalId);
    if (!e) return;
    // Semente da "data provável" a partir da janela do edital — assim ela não
    // se perde ao (re)gerar o plano e segue persistindo/sincronizando.
    const jp = e.janelaProva || {};
    const radarSeed = jp.inicio
      ? { janela_prova: [jp.inicio, jp.fim || jp.inicio], confianca: 'manual', reavaliar_em: null }
      : null;
    const json = {
      versao: 1,
      gerado_em: D.hojeISO(),
      plano: {
        concurso: e.titulo,
        banca: e.banca || '',
        orgao: e.orgao || '',
        cargo: e.cargo || '',
        estado: e.estado || '',
        foto: e.foto || e.fotoUrl || e.imagem || '',
        // vínculo com o edital de origem: permite atualizar o plano quando o
        // edital mudar (ex.: sai o edital real depois do pré-edital).
        origemEditalId: e.id || null,
        origemEditalVersao: e.atualizadoEm || '',
        meta: {
          corte_pct: e.notaCorte || 70,
          corte_lista: normalizarListaCorte(e.tipoCorte),
          corte_fonte: 'notas de corte do edital',
          cortes: {
            ampla: e.cortes && e.cortes.ampla != null ? e.cortes.ampla : (e.notaCorte || 70),
            negros: e.cortes && e.cortes.negros != null ? e.cortes.negros : null,
            pcd: e.cortes && e.cortes.pcd != null ? e.cortes.pcd : null
          }
        },
        radar: radarSeed,
        ritmos: null
      },
      disciplinas: e.disciplinas,
      cronograma: {}
    };
    const v = D.validarPlano(json);
    if (!v.ok) { toast('Edital inválido: ' + v.erros[0], 'erro'); return; }
    // "Refazer plano": se já existe um plano deste edital, reaproveita (ativa e
    // reabre o assistente) em vez de criar um duplicado no catálogo.
    const existente = state.planos.find(function (p) { return p.plano && p.plano.concurso === e.titulo; });
    if (existente) {
      window.Store.ativarPlano(state, existente.id);
      salvar();
      if (location.hash !== '#planejamento') history.pushState(null, '', '#planejamento');
      render();
      abrirGerarPlanoComRotina(); // sem novoPlanoId → cancelar não apaga o plano existente
      return;
    }
    // Limite de 1 plano por vez (o refazer acima já tratou o mesmo edital).
    const permissao = await limitePlanoBloqueia(e);
    if (!permissao.permitido) return;
    // Guarda o plano ativo anterior: se o usuário sair do assistente sem concluir,
    // o plano recém-criado é removido (não fica um plano "fantasma" no catálogo).
    const planoAnteriorId = state.planoAtivoId;
    const entrada = adicionarPlano(json);
    // Marca como RASCUNHO: se o assistente for fechado por qualquer caminho que
    // escape do descarte (back do celular, app fechado, recarregar), este plano
    // é varrido na próxima carga (limparPlanosRascunho). Limpo ao gerar o plano.
    if (entrada && entrada.plano) entrada.plano.rascunho = true;
    aplicarPlanosDuracaoAoAtivo(true);
    // pushState não dispara hashchange (que fecharia o modal de rotina abaixo)
    if (location.hash !== '#planejamento') history.pushState(null, '', '#planejamento');
    render();
    abrirGerarPlanoComRotina({
      novoPlanoId: entrada.id,
      planoAnteriorId: planoAnteriorId,
      trocaPlano: permissao.troca
    });
  }

  // ---- Atualização de plano quando o edital de origem muda (pré-edital → real) ----
  function editalDaOrigemDoPlano(planoEntry) {
    const pl = planoEntry && planoEntry.plano;
    if (!pl || !pl.origemEditalId) return null;
    return editaisDoCatalogo().find(function (e) { return e.id === pl.origemEditalId; }) || null;
  }

  // Retorna o edital de origem se houver versão mais nova que a do plano; senão null.
  function atualizacaoEditalPendente(planoEntry) {
    const ed = editalDaOrigemDoPlano(planoEntry);
    if (!ed || !ed.atualizadoEm) return null;
    const versaoPlano = (planoEntry.plano && planoEntry.plano.origemEditalVersao) || '';
    return ed.atualizadoEm !== versaoPlano ? ed : null;
  }

  function planoAtivoEntry() {
    return (state.planos || []).find(function (p) { return p.id === state.planoAtivoId; }) || null;
  }

  function atualizarPlanoAtivoDoEdital() {
    const planoEntry = planoAtivoEntry();
    if (!planoEntry) return;
    const ed = atualizacaoEditalPendente(planoEntry);
    if (!ed) { toast('Este plano já está na versão atual do edital.', 'sucesso'); return; }
    const res = D.mesclarEditalNoPlano(planoEntry.disciplinas, clonarJson(ed.disciplinas));
    planoEntry.disciplinas = res.disciplinas;
    const pl = planoEntry.plano; pl.meta = pl.meta || {};
    pl.meta.corte_pct = ed.notaCorte || pl.meta.corte_pct || 70;
    pl.meta.cortes = {
      ampla: ed.cortes && ed.cortes.ampla != null ? ed.cortes.ampla : (ed.notaCorte || pl.meta.corte_pct),
      negros: ed.cortes && ed.cortes.negros != null ? ed.cortes.negros : null,
      pcd: ed.cortes && ed.cortes.pcd != null ? ed.cortes.pcd : null
    };
    if (ed.foto) pl.foto = ed.foto;
    const jp = ed.janelaProva || {};
    if (jp.inicio) {
      const prev = pl.radar || {};
      pl.radar = { janela_prova: [jp.inicio, jp.fim || jp.inicio], confianca: prev.confianca || 'manual', reavaliar_em: prev.reavaliar_em || null };
    }
    pl.origemEditalVersao = ed.atualizadoEm;
    window.Store.hidratar(state);
    salvar();
    render();
    const r = res.resumo; const partes = [];
    if (r.topicosNovos) partes.push(r.topicosNovos + ' tópico(s) novo(s)');
    if (r.topicosRemovidos) partes.push(r.topicosRemovidos + ' removido(s)');
    if (r.disciplinasNovas) partes.push(r.disciplinasNovas + ' disciplina(s) nova(s)');
    toast('Plano atualizado pelo edital (' + (partes.length ? partes.join(', ') : 'metadados atualizados') + '). Recalcule o plano para encaixar os novos tópicos.', 'sucesso');
  }

  function ligarEditaisEsquematizados(raiz) {
    if (!usuarioAdmin()) return;
    const admBusca = raiz.querySelector('#adm-busca');
    if (admBusca) {
      const aplicar = function () { adminBusca = admBusca.value; render(); };
      admBusca.addEventListener('change', aplicar);
      admBusca.addEventListener('search', aplicar);
      admBusca.addEventListener('keydown', function (e) { if (e.key === 'Enter') aplicar(); });
    }
    const novo = raiz.querySelector('#adm-novo');
    if (novo) novo.addEventListener('click', function () { abrirEditorEdital(null, 'novo'); });
    const importar = raiz.querySelector('#adm-importar');
    if (importar) importar.addEventListener('click', abrirImportarEdital);
    const pedidos = raiz.querySelector('#adm-pedidos');
    if (pedidos) pedidos.addEventListener('click', abrirListaPedidos);
    raiz.querySelectorAll('[data-ed-editar]').forEach(function (b) {
      b.addEventListener('click', function () { abrirEditorEdital(b.getAttribute('data-ed-editar'), 'editar'); });
    });
    raiz.querySelectorAll('[data-ed-plano]').forEach(function (b) {
      b.addEventListener('click', function () { criarPlanoDeEdital(b.getAttribute('data-ed-plano')); });
    });
    raiz.querySelectorAll('[data-ed-excluir]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = b.getAttribute('data-ed-excluir');
        // o edital pode estar só no catálogo global (não no perfil) — procura nos dois
        const e = (state.editais || []).find(function (x) { return x.id === id; }) ||
          (catalogoGlobalEditais || []).find(function (x) { return x.id === id; });
        if (!e) return;
        confirmar({ titulo: 'Excluir edital?', mensagem: 'O edital "' + e.titulo + '" será removido do catálogo global. Os planos já criados a partir dele continuam existindo.', confirmar: 'Excluir', perigo: true, icone: '🗑️' }).then(function (ok) {
          if (!ok) return;
          // remove do perfil e do catálogo global em memória; publicarCatalogoAdmin
          // republica a união já sem ele (removerId garante a exclusão).
          state.editais = (state.editais || []).filter(function (x) { return x.id !== id; });
          catalogoGlobalEditais = (catalogoGlobalEditais || []).filter(function (x) { return x.id !== id; });
          salvar(); publicarCatalogoAdmin({ toast: true, permitirVazio: true, removerId: id }).finally(render);
          toast('Edital excluído');
        });
      });
    });
  }

  // ================= Catálogo: aba "Planos disponíveis" =================
  function editalFotoHtml(e) {
    const src = e.foto || e.fotoUrl || e.imagem || '';
    const alt = e.fotoAlt || '';
    const iniciais = String(e.orgao || e.titulo || 'ED').replace(/[^0-9A-Za-z\u00C0-\u017F ]/g, ' ').trim().split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0); }).join('').toUpperCase() || 'ED';
    return src
      ? '<span class="catalogo-foto"><img src="' + esc(src) + '" alt="' + esc(alt) + '"></span>'
      : '<span class="catalogo-foto catalogo-foto-placeholder" aria-hidden="true">' + esc(iniciais) + '</span>';
  }

  function fotoCreditoHtml(e) {
    if (!e || !e.fotoCredito) return '';
    const fonte = /^https:\/\//i.test(e.fotoFonte || '') ? e.fotoFonte : '';
    const credito = fonte
      ? '<a href="' + esc(fonte) + '" target="_blank" rel="noopener noreferrer">' + esc(e.fotoCredito) + '</a>'
      : esc(e.fotoCredito);
    return '<p class="sub" style="margin:0.2rem 0 0.6rem"><strong>Foto:</strong> ' + credito + '</p>';
  }

  function rotuloCorteEdital(e) {
    if (e && e.metaDesempenho) return (e.notaCorte || 80) + '%';
    // o rótulo do card já diz "Corte"; aqui vai só o valor: "73% · ampla"
    const lista = normalizarListaCorte(e.tipoCorte || e.corteTipo || e.modalidadeCorte || 'ampla');
    const curto = { ampla: 'ampla', negros: 'negros', pcd: 'PcD', indigenas: 'indígenas' }[lista] || 'ampla';
    return (e.notaCorte || 70) + '% · ' + curto;
  }

  function ehPlanoCarreira(e) {
    return !!(e && e.tipoCatalogo === 'carreira');
  }

  function catalogoCard(e) {
    const nt = contarTopicosEdital(e);
    const jaTem = state.planos.some(function (p) { return p.plano.concurso === e.titulo; });
    const tags = [e.orgao, e.area, e.estado].filter(Boolean).map(function (t) { return '<span class="edital-tag">' + esc(t) + '</span>'; }).join('');
    function metrica(rot, val) { return '<span class="catalogo-metrica"><span class="cm-rotulo">' + rot + '</span><span class="cm-valor">' + val + '</span></span>'; }
    return '<div class="card catalogo-card">' +
      '<div class="catalogo-card-topo"><strong class="catalogo-titulo">' + esc(e.titulo) + '</strong>' +
      (e.emAlta ? '<span class="etiqueta etiqueta-alta">em alta</span>' : '') + '</div>' +
      (tags ? '<div class="edital-tags">' + tags + '</div>' : '') +
      '<div class="catalogo-metricas">' +
      metrica(e.metaDesempenho ? 'Meta' : 'Corte', (e.metaDesempenho ? '' : '~') + (e.notaCorte || 70) + '%') +
      metrica('Escolaridade', esc(NIVEIS_EDITAL[nivelEdital(e)])) +
      metrica('Data estimada', esc(janelaProvaTexto(e))) +
      metrica('Tempo médio', '~' + tempoMedioMesesEdital(e) + ' meses') +
      '</div>' +
      '<div class="catalogo-sub">' + esc(e.banca || 'banca não informada') + ' · ' + (e.disciplinas || []).length + ' disciplinas · ' + nt + ' tópicos</div>' +
      '<div class="catalogo-acoes">' +
      '<button class="botao-mini botao-secundario" data-pl-detalhes="' + esc(e.id) + '">Ver detalhes</button>' +
      '<button class="botao-mini" data-pl-iniciar="' + esc(e.id) + '">' + (jaTem ? 'Refazer plano' : 'Iniciar plano') + '</button>' +
      '<button class="botao-mini botao-quieto" data-pl-comparar="' + esc(e.id) + '">Comparar</button>' +
      '</div>' +
      (jaTem ? '<span class="etiqueta etiqueta-feito" style="margin-top:0.4rem">plano criado ✓</span>' : '') +
      '</div>';
  }

  function catalogoCardCompacto(e) {
    const nt = contarTopicosEdital(e);
    const jaTem = state.planos.some(function (p) { return p.plano.concurso === e.titulo; });
    const selComparar = comparacaoIds.indexOf(e.id) >= 0;
    const calc = calculadoraDoEdital(e);
    const carreira = ehPlanoCarreira(e);
    function metrica(rot, val) { return '<span class="catalogo-metrica"><span class="cm-rotulo">' + rot + '</span><span class="cm-valor">' + val + '</span></span>'; }
    const subtitulo = carreira
      ? esc(e.banca || 'Base de provas') + ' · ' + (e.disciplinas || []).length + ' disciplinas · ' + nt + ' tópicos prioritários'
      : esc(e.banca || 'banca não informada') + ' · ' + (e.disciplinas || []).length + ' disciplinas · ' + nt + ' tópicos';
    const metricas = carreira
      ? metrica('Cobertura', esc(e.cobertura || 'Nacional')) +
        metrica('Perfil', esc(e.area || 'Área administrativa')) +
        metrica('Meta inicial', (e.notaCorte || 80) + '%')
      : metrica(e.metaDesempenho ? 'Meta' : 'Corte', esc(rotuloCorteEdital(e))) +
        metrica('Escolaridade', esc(NIVEIS_EDITAL[nivelEdital(e)])) +
        metrica('Data estimada', esc(janelaProvaTexto(e)));
    return '<div class="card catalogo-card catalogo-card-compacto' + (carreira ? ' catalogo-card-carreira' : '') + (selComparar ? ' catalogo-card-comparando' : '') + '">' +
      '<div class="catalogo-card-topo">' + editalFotoHtml(e) +
      '<div class="catalogo-card-info"><strong class="catalogo-titulo">' + esc(e.titulo) +
      (carreira ? ' <span class="etiqueta etiqueta-carreira">plano de carreira</span>' : (e.emAlta ? ' <span class="etiqueta etiqueta-alta">em alta</span>' : '')) + '</strong>' +
      '<span class="catalogo-sub">' + subtitulo +
      (calc ? ' <button type="button" class="catalogo-calc-mini" data-pl-calc="' + esc(e.id) + '" title="Estimar a remuneração do cargo">💰 Calculadora de salário</button>' : '') +
      '</span>' +
      (jaTem ? '<span class="etiqueta etiqueta-feito catalogo-feito">plano criado ✓</span>' : '') +
      '</div></div>' +
      (carreira ? '<p class="catalogo-carreira-promessa">Comece pelo núcleo que mais se repete e especialize o plano quando sair um edital específico.</p>' : '') +
      '<div class="catalogo-metricas">' + metricas + '</div>' +
      '<div class="catalogo-acoes">' +
      '<button class="botao-mini botao-secundario" data-pl-detalhes="' + esc(e.id) + '" title="Ver disciplinas, tópicos e prioridades">Detalhes</button>' +
      '<button class="botao-mini" data-pl-iniciar="' + esc(e.id) + '" title="Gerar plano a partir desta seleção">' + (jaTem ? 'Refazer' : (carreira ? 'Começar pela carreira' : 'Iniciar')) + '</button>' +
      '<button class="botao-mini ' + (selComparar ? 'catalogo-comparar-on' : 'botao-quieto') + '" data-pl-comparar="' + esc(e.id) + '" title="Selecionar para comparar (máx. 2)">' + (selComparar ? '✓ Comparando' : 'Comparar') + '</button>' +
      '</div>' +
      '</div>';
  }

  function telaPlanos() {
    garantirEditaisMock();
    const lista = editaisDoCatalogo().filter(function (e) { return !e.arquivado && !ehEditalCombinado(e); })
      .slice().sort(function (a, b) { return (b.emAlta ? 1 : 0) - (a.emAlta ? 1 : 0) || contarTopicosEdital(b) - contarTopicosEdital(a); });
    let html = '<div class="cab-pagina"><div><span class="rotulo-pagina">Catálogo</span><h1>Planos disponíveis</h1></div></div>' +
      '<p class="sub" style="margin-bottom:1rem">Escolha um concurso para gerar seu plano de estudos. Use <strong>Comparar</strong> para saber se dá para conciliar dois editais.</p>';
    if (lista.length === 0) {
      html += '<div class="estado-vazio"><span class="bolha bolha-pendente"></span><strong>Nenhum plano disponível ainda</strong>' +
        'Não encontrou seu concurso? Peça o cadastro ao suporte.' +
        '<p style="margin-top:1rem"><button class="botao" type="button" data-pedir-edital>✉ Pedir um edital</button></p></div>';
      return html;
    }
    html += '<div class="catalogo-grade">' + lista.map(catalogoCard).join('') + '</div>';
    return html;
  }

  function telaPlanosNova() {
    garantirEditaisMock();
    const lista = editaisDoCatalogo().filter(function (e) {
      return !e.arquivado && !ehEditalCombinado(e) && editalCorrespondeFiltro(e, catalogoFiltro);
    }).slice().sort(function (a, b) {
      return (ehPlanoCarreira(b) ? 1 : 0) - (ehPlanoCarreira(a) ? 1 : 0) ||
        (b.emAlta ? 1 : 0) - (a.emAlta ? 1 : 0) || contarTopicosEdital(b) - contarTopicosEdital(a);
    });
    function selectFiltro(campo, rotulo) {
      const opts = valoresUnicosEditais(campo).map(function (v) {
        return '<option value="' + esc(v) + '"' + (catalogoFiltro[campo] === v ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('');
      return '<select data-cat-filtro="' + campo + '" title="' + rotulo + '"><option value="">' + rotulo + '</option>' + opts + '</select>';
    }
    const tipoAtual = catalogoFiltro.tipo || 'todos';
    const tiposHtml = '<div class="catalogo-tipos" role="tablist" aria-label="Tipo de plano">' +
      [['todos', 'Todos'], ['carreira', 'Carreiras'], ['concurso', 'Concursos']].map(function (tipo) {
        const ativo = tipoAtual === tipo[0];
        return '<button type="button" role="tab" aria-selected="' + (ativo ? 'true' : 'false') + '" class="' + (ativo ? 'ativo' : '') + '" data-cat-tipo="' + tipo[0] + '">' + tipo[1] + '</button>';
      }).join('') + '</div>';
    const carreiraIntro = tipoAtual === 'carreira'
      ? '<div class="card carreira-intro"><span class="carreira-intro-icone" aria-hidden="true">⌁</span><div>' +
        '<strong>Ainda não escolheu um concurso específico?</strong>' +
        '<p class="sub">Estude o núcleo recorrente da carreira agora. Quando sair o concurso, troque para o plano específico e o sistema oferece reaproveitar seu histórico compatível.</p>' +
        '</div></div>'
      : '';
    let html = '<div class="cab-pagina"><div><span class="rotulo-pagina">Catálogo de planos</span><h1>Planos</h1></div></div>' +
      guiaBoasVindasPlanosHtml() +
      tiposHtml +
      carreiraIntro +
      (tipoAtual === 'carreira' ? '' : cardAvisoCompararHtml()) +
      '<div class="catalogo-toolbar">' +
      '<input id="cat-busca" type="search" placeholder="Pesquisar plano ou concurso" value="' + esc(catalogoFiltro.busca || '') + '">' +
      '<div class="catalogo-filtros">' + selectFiltro('orgao', 'Órgão') + selectFiltro('cargo', 'Cargo') + selectFiltro('estado', 'Estado') +
      '<button class="botao-mini botao-quieto" id="cat-limpar" title="Limpar busca e filtros">Limpar</button></div></div>';
    if (lista.length === 0) {
      const filtroAtivo = !!(catalogoFiltro.busca || catalogoFiltro.orgao || catalogoFiltro.cargo || catalogoFiltro.estado || tipoAtual !== 'todos');
      let titulo, sub, offline = false;
      if (!catalogoGlobalCarregado) { titulo = 'Carregando catálogo…'; sub = 'Buscando os editais publicados.'; }
      else if (filtroAtivo) { titulo = 'Nenhum edital encontrado'; sub = 'Tente outra busca ou peça um edital.'; }
      else { titulo = 'Fique online para ver o catálogo'; sub = 'O catálogo de planos precisa de internet. O resto do app continua funcionando normalmente.'; offline = true; }
      html += '<div class="estado-vazio"><span class="bolha bolha-pendente"></span><strong>' + titulo + '</strong>' +
        '<p class="sub">' + sub + '</p>' +
        // sem internet não dá pra pedir edital; só oferece o botão quando online
        (offline || !catalogoGlobalCarregado ? '' : '<p style="margin-top:1rem"><button class="botao" type="button" data-pedir-edital>✉ Pedir um edital</button></p>') +
        '</div>';
      return html;
    }
    html += '<div class="catalogo-grade">' + lista.map(catalogoCardCompacto).join('') + '</div>';
    return html;
  }

  // Mostra um guia de boas-vindas, centralizado, logo após o usuário informar o
  // nome no primeiro acesso. Explica como o sistema funciona e oferece os dois
  // caminhos: escolher um edital do catálogo ou montar um plano manual (útil para
  // quem não estuda para concurso, ex.: faculdade). Some assim que a pessoa já
  // tiver um plano ativo ou tocar em "Entendi".
  function deveMostrarGuiaPlanos() {
    return usuarioLogado() && !modoDemo && !state.plano &&
      !(state.config && state.config.onboardingGuiaVisto);
  }

  function guiaBoasVindasPlanosHtml() {
    if (!deveMostrarGuiaPlanos()) return '';
    const nome = (state.config && state.config.nomeUsuario || '').trim();
    const ola = nome ? 'Tudo certo, ' + esc(nome) + '! ' : 'Tudo certo! ';
    return '<div class="card guia-planos">' +
      '<button class="guia-planos-fechar" type="button" id="guia-planos-fechar" aria-label="Fechar guia">×</button>' +
      '<div class="guia-planos-icone" aria-hidden="true">🎯</div>' +
      '<h2>' + ola + 'Vamos começar sua jornada</h2>' +
      '<p class="sub">O Gabaritei OS monta seu cronograma de estudos, agenda revisões automáticas ' +
      'e acompanha seu progresso. Para começar, <strong>escolha o seu edital</strong> no catálogo abaixo — ' +
      'o sistema gera um plano sob medida com base nele.</p>' +
      '<p class="sub guia-planos-alt">Não está estudando para um concurso específico (ex.: provas da faculdade)? ' +
      'Você também pode <strong>montar um plano do zero</strong>.</p>' +
      '<div class="guia-planos-acoes">' +
      '<button class="botao" type="button" id="guia-planos-manual">✏️ Criar plano manual</button>' +
      '<button class="botao-quieto" type="button" id="guia-planos-ok">Entendi, ver editais ↓</button>' +
      '</div></div>';
  }

  function fecharGuiaPlanos() {
    if (state.config) { state.config.onboardingGuiaVisto = true; salvar(); }
  }

  function editaisComparaveis() {
    return editaisDoCatalogo().filter(function (e) { return !e.arquivado && !ehEditalCombinado(e); });
  }

  function cardAvisoCompararHtml() {
    if (editaisComparaveis().length < 2) return '';
    const horas = horasSemanaDisponiveis();
    const detalhe = comparacaoPrecisaHorasManuais()
      ? 'Se você ainda não configurou rotina, o sistema pergunta suas horas semanais na hora da comparação.'
      : 'A comparação usa sua rotina atual (~' + horas + 'h/semana).';
    return '<div class="card comparar-secao comparar-aviso">' +
      '<strong class="comparar-summary-tit">🔀 Comparar dois editais</strong>' +
      '<p class="sub">Toque em <strong>Comparar</strong> em dois editais para saber se dá para conciliá-los. ' + detalhe + ' O resultado aparece em uma janela no centro da tela.</p>' +
      '</div>';
  }

  // mantém só ids válidos e no máximo 2 selecionados; devolve os editais
  function sanearComparacao() {
    const editais = editaisComparaveis();
    comparacaoIds = comparacaoIds.filter(function (id) {
      return editais.some(function (e) { return e.id === id; });
    }).slice(-2);
    return comparacaoIds.map(function (id) {
      return editais.find(function (e) { return e.id === id; });
    }).filter(Boolean);
  }

  // alterna a seleção de um edital para comparação (limite de 2 por vez)
  function alternarComparacao(id) {
    const i = comparacaoIds.indexOf(id);
    if (i >= 0) comparacaoIds.splice(i, 1);
    else {
      comparacaoIds.push(id);
      if (comparacaoIds.length > 2) comparacaoIds.shift(); // descarta o mais antigo
    }
    render();
    if (i < 0 && sanearComparacao().length === 2) {
      abrirModalComparacaoSelecionada();
    }
  }

  function abrirModalComparacaoSelecionada() {
    const sel = sanearComparacao();
    if (sel.length < 2) return;
    const pedirHoras = comparacaoPrecisaHorasManuais();
    let horasComparacao = horasSemanaDisponiveis();
    let r = D.conciliarPlanos(sel[0], sel[1], { horasSemana: horasComparacao });
    let manterSelecaoAoFechar = false;
    const chips = '<div class="comparar-chips">' + sel.map(function (e) {
      return '<span class="comparar-chip">' + esc(tituloCurto(e.titulo)) + '</span>';
    }).join('') + '</div>';
    const horasHtml = pedirHoras
      ? '<div class="comparar-horas-box"><label for="cmp-modal-horas">Quantas horas por semana você consegue estudar?</label>' +
        '<div class="comparar-horas-linha"><input id="cmp-modal-horas" type="number" min="1" max="80" value="' + esc(horasComparacao) + '">' +
        '<span class="sub">Usado só nesta comparação.</span></div></div>'
      : '<p class="sub">Veja se dá para conciliar esses dois planos na sua rotina atual (~' + horasComparacao + 'h/semana).</p>';
    const m = abrirModal(
      '<h3>Comparação dos editais</h3>' +
      horasHtml +
      chips +
      '<div class="comparar-resultado" id="cmp-modal-resultado">' + vereditoConciliacaoHtml(r) + '</div>' +
      '<div class="modal-acoes">' +
      '<button type="button" class="botao-quieto" id="cmp-modal-limpar">Limpar seleção</button>' +
      '<button type="button" class="botao-secundario" id="cmp-modal-fechar">Fechar</button>' +
      '<button type="button" id="cmp-modal-combinar">Gerar plano combinado</button></div>'
    );
    m.classList.add('modal-amplo');
    aoFecharModal = function () {
      if (manterSelecaoAoFechar) return;
      comparacaoIds = [];
      render();
    };
    function limparComparacaoEFechar() {
      comparacaoIds = [];
      fecharModal();
      render();
    }
    m.querySelector('#cmp-modal-fechar').addEventListener('click', limparComparacaoEFechar);
    const fundoComparacao = m.parentElement;
    if (fundoComparacao) {
      fundoComparacao.addEventListener('click', function (e) {
        if (e.target === e.currentTarget) comparacaoIds = [];
      }, true);
    }
    m.querySelector('#cmp-modal-limpar').addEventListener('click', function () {
      manterSelecaoAoFechar = true;
      comparacaoIds = [];
      fecharModal();
      render();
    });
    const horasInput = m.querySelector('#cmp-modal-horas');
    const resultadoEl = m.querySelector('#cmp-modal-resultado');
    function recalcularModalComparacao() {
      if (!horasInput || !resultadoEl) return;
      horasComparacao = Math.max(1, Math.min(80, parseInt(horasInput.value, 10) || 1));
      r = D.conciliarPlanos(sel[0], sel[1], { horasSemana: horasComparacao });
      resultadoEl.innerHTML = vereditoConciliacaoHtml(r);
    }
    if (horasInput) {
      horasInput.addEventListener('input', recalcularModalComparacao);
      horasInput.addEventListener('change', recalcularModalComparacao);
    }
    m.querySelector('#cmp-modal-combinar').addEventListener('click', function () {
      recalcularModalComparacao();
      manterSelecaoAoFechar = true;
      if (r.nivel === 'nao_recomendado') {
        confirmar({ titulo: 'Compatibilidade baixa', mensagem: 'Seriam ~' + r.detalhes.exigidaSemana + 'h/semana exigidas vs ~' + r.detalhes.horasSemana + 'h disponíveis. Gerar o plano combinado mesmo assim?', confirmar: 'Gerar mesmo assim', icone: '⚠️' }).then(function (ok) {
          if (ok) gerarPlanoCombinado(sel[0], sel[1]);
        });
        return;
      }
      gerarPlanoCombinado(sel[0], sel[1]);
    });
  }

  // Seção "Comparar dois editais" no topo da aba Planos — o aluno seleciona até
  // 2 editais nos cards (botão "Comparar") e vê aqui a viabilidade de conciliar.
  function secaoCompararHtml() {
    const editais = editaisComparaveis();
    if (editais.length < 2) return '';
    const sel = sanearComparacao();
    function chip(e) {
      return '<span class="comparar-chip">' + esc(tituloCurto(e.titulo)) +
        '<button type="button" class="comparar-chip-x" data-cmp-remover="' + esc(e.id) + '" aria-label="Remover da comparação">×</button></span>';
    }
    let corpo;
    if (sel.length < 2) {
      const faltam = 2 - sel.length;
      corpo = '<p class="sub">Toque em <strong>Comparar</strong> em dois editais abaixo para ver se dá para conciliá-los na sua rotina (~' + horasSemanaDisponiveis() + 'h/semana).</p>' +
        (sel.length ? '<div class="comparar-chips">' + sel.map(chip).join('') + '</div>' : '') +
        '<p class="comparar-hint">Selecione mais <strong>' + faltam + '</strong> edital' + (faltam > 1 ? 'is' : '') + '.</p>';
    } else {
      const r = D.conciliarPlanos(sel[0], sel[1], { horasSemana: horasSemanaDisponiveis() });
      corpo = '<div class="comparar-chips">' + sel.map(chip).join('') + '</div>' +
        '<div class="comparar-resultado">' + vereditoConciliacaoHtml(r) + '</div>' +
        '<div class="compact-actions" style="margin-top:0.6rem;justify-content:flex-end">' +
        '<button class="botao-mini botao-quieto" id="cmp-limpar">Limpar</button>' +
        '<button class="botao-mini" id="cmp-sec-combinar">Gerar plano combinado</button></div>';
    }
    return '<details class="card comparar-secao" id="cmp-secao" open>' +
      '<summary class="comparar-summary"><span class="comparar-summary-tit">🔀 Comparar dois editais</span>' +
      '<span class="sub">Veja se vale a pena estudar para dois concursos ao mesmo tempo.</span></summary>' +
      '<div class="comparar-corpo">' + corpo + '</div></details>';
  }

  function ligarSecaoComparar(raiz) {
    raiz.querySelectorAll('[data-cmp-remover]').forEach(function (b) {
      b.addEventListener('click', function () { alternarComparacao(b.getAttribute('data-cmp-remover')); });
    });
    const limpar = raiz.querySelector('#cmp-limpar');
    if (limpar) limpar.addEventListener('click', function () { comparacaoIds = []; render(); });
    const combinar = raiz.querySelector('#cmp-sec-combinar');
    if (combinar) combinar.addEventListener('click', function () {
      const sel = sanearComparacao();
      if (sel.length < 2) { toast('Selecione dois editais para comparar.', 'erro'); return; }
      const r = D.conciliarPlanos(sel[0], sel[1], { horasSemana: horasSemanaDisponiveis() });
      if (r.nivel === 'nao_recomendado') {
        confirmar({ titulo: 'Compatibilidade baixa', mensagem: 'Seriam ~' + r.detalhes.exigidaSemana + 'h/semana exigidas vs ~' + r.detalhes.horasSemana + 'h disponíveis. Gerar o plano combinado mesmo assim?', confirmar: 'Gerar mesmo assim', icone: '⚠️' }).then(function (ok) {
          if (ok) gerarPlanoCombinado(sel[0], sel[1]);
        });
        return;
      }
      gerarPlanoCombinado(sel[0], sel[1]);
    });
  }

  function ligarPlanos(raiz) {
    raiz.querySelectorAll('[data-cat-tipo]').forEach(function (b) {
      b.addEventListener('click', function () {
        catalogoFiltro.tipo = b.getAttribute('data-cat-tipo') || 'todos';
        catalogoFiltro.orgao = '';
        catalogoFiltro.estado = '';
        render();
      });
    });
    const busca = raiz.querySelector('#cat-busca');
    if (busca) {
      const aplicarBusca = function () { catalogoFiltro.busca = busca.value; render(); };
      busca.addEventListener('change', aplicarBusca);
      busca.addEventListener('keydown', function (e) { if (e.key === 'Enter') aplicarBusca(); });
      let buscaPendente = null;
      busca.addEventListener('input', function () {
        clearTimeout(buscaPendente);
        const valor = busca.value;
        buscaPendente = setTimeout(function () {
          catalogoFiltro.busca = valor;
          render();
          const novoCampo = document.querySelector('#cat-busca');
          if (novoCampo) {
            novoCampo.focus();
            novoCampo.setSelectionRange(novoCampo.value.length, novoCampo.value.length);
          }
        }, 180);
      });
    }
    raiz.querySelectorAll('[data-cat-filtro]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        catalogoFiltro[sel.getAttribute('data-cat-filtro')] = sel.value;
        render();
      });
    });
    const limpar = raiz.querySelector('#cat-limpar');
    if (limpar) limpar.addEventListener('click', function () {
      catalogoFiltro = { tipo: catalogoFiltro.tipo || 'todos', busca: '', orgao: '', cargo: '', estado: '' };
      render();
    });
    raiz.querySelectorAll('[data-pedir-edital]').forEach(function (b) {
      b.addEventListener('click', function () { abrirPedidoEdital(catalogoFiltro); });
    });
    raiz.querySelectorAll('[data-pl-detalhes]').forEach(function (b) {
      b.addEventListener('click', function () { abrirDetalhesEdital(b.getAttribute('data-pl-detalhes')); });
    });
    raiz.querySelectorAll('[data-pl-calc]').forEach(function (b) {
      b.addEventListener('click', function () { abrirCalculadoraRemuneracao(calculadoraDoEdital(editalPorId(b.getAttribute('data-pl-calc')))); });
    });
    raiz.querySelectorAll('[data-pl-iniciar]').forEach(function (b) {
      b.addEventListener('click', function () { criarPlanoDeEdital(b.getAttribute('data-pl-iniciar')); });
    });
    raiz.querySelectorAll('[data-pl-comparar]').forEach(function (b) {
      b.addEventListener('click', function () { alternarComparacao(b.getAttribute('data-pl-comparar')); });
    });
    const guiaFechar = raiz.querySelector('#guia-planos-fechar');
    const guiaOk = raiz.querySelector('#guia-planos-ok');
    [guiaFechar, guiaOk].forEach(function (b) {
      if (b) b.addEventListener('click', function () { fecharGuiaPlanos(); render(); });
    });
    const guiaManual = raiz.querySelector('#guia-planos-manual');
    if (guiaManual) guiaManual.addEventListener('click', function () {
      fecharGuiaPlanos();
      criarPlanoManualComPrompt();
    });
  }

  function abrirDetalhesEdital(id) {
    const e = editalPorId(id);
    if (!e) return;
    const calc = calculadoraDoEdital(e);
    const carreira = ehPlanoCarreira(e);
    // Disciplinas com tópicos · incidência · horas (antiga "tela 2", agora direto)
    const discHtml = (e.disciplinas || []).map(function (d) {
      const tops = (d.topicos || []).slice().sort(function (a, b) { return (b.incidencia_pct || 0) - (a.incidencia_pct || 0); });
      const linhas = tops.map(function (t) {
        return '<tr><td>' + esc(t.nome) + '</td><td class="num">' + (t.incidencia_pct || 0) + '%</td><td class="num">' + (t.horas_estimadas || 2) + 'h</td></tr>';
      }).join('');
      const cor = /^#/.test(d.cor || '') ? d.cor : '#6B7180';
      return '<div class="detalhe-disc"><div class="detalhe-disc-cab">' +
        '<span class="tag-disc" style="background:' + esc(cor) + '22;color:' + esc(cor) + '">' + esc(d.nome) + '</span>' +
        '<span class="sub">peso ' + (d.peso || 1) + ' · ' + (d.topicos || []).length + ' tópicos</span></div>' +
        '<table class="tabela-topicos"><thead><tr><th>Tópico</th><th class="num">' + (carreira ? 'Prior.' : 'Incid.') + '</th><th class="num">Horas</th></tr></thead><tbody>' + linhas + '</tbody></table></div>';
    }).join('');
    function metrica(rot, val) { return '<span class="catalogo-metrica"><span class="cm-rotulo">' + rot + '</span><span class="cm-valor">' + val + '</span></span>'; }
    const m = abrirModal('<h3 class="detalhe-titulo">' + esc(e.titulo) + '</h3>' +
      '<p class="sub">' + (carreira ? '<span class="etiqueta etiqueta-carreira">plano de carreira</span> · ' : '') + esc(e.banca || 'banca não informada') + (e.orgao ? ' · ' + esc(e.orgao) : '') + (e.cargo ? ' · ' + esc(e.cargo) : '') + '</p>' +
      '<div class="catalogo-metricas" style="margin:0.5rem 0">' +
      (e.area ? metrica('Área', esc(e.area)) : '') +
      metrica(carreira || e.metaDesempenho ? 'Meta inicial' : 'Corte', (carreira || e.metaDesempenho ? '' : '~') + (e.notaCorte || 70) + '%') +
      metrica('Escolaridade', esc(NIVEIS_EDITAL[nivelEdital(e)])) +
      (carreira ? metrica('Cobertura', esc(e.cobertura || 'Nacional')) : metrica('Data estimada', esc(janelaProvaTexto(e)))) +
      metrica('Esforço', '~' + horasEsforcoEdital(e) + 'h') +
      (e.salario ? metrica('Salário', esc(e.salario)) : '') +
      (e.vagas != null && e.vagas !== '' ? metrica('Vagas', esc(e.vagas)) : '') +
      '</div>' +
      (e.beneficios ? '<p class="sub" style="margin:0.1rem 0 0.5rem"><strong>Benefícios:</strong> ' + esc(e.beneficios) + '</p>' : '') +
      (carreira ? '<div class="carreira-metodologia"><strong>Como esta trilha foi montada</strong><p>' + esc(e.metodologia || '') + '</p>' +
        '<p><strong>Base analisada:</strong> ' + esc((e.baseEditais || []).join(' · ')) + '</p>' +
        '<p><strong>Fontes:</strong> ' + esc(e.fontesResumo || '') + '</p></div>' : '') +
      (!carreira && (e.observacoes || e.fonte) ? '<div class="carreira-metodologia"><strong>Sobre este plano</strong>' +
        (e.observacoes ? '<p>' + esc(e.observacoes) + '</p>' : '') +
        (e.fonte ? '<p><strong>Base estatística:</strong> ' + esc(e.fonte) + '</p>' : '') + '</div>' : '') +
      fotoCreditoHtml(e) +
      '<p class="sub" style="margin:0.2rem 0 0.4rem">Disciplinas e tópicos (' + (carreira ? 'prioridade relativa e horas estimadas' : 'incidência nas provas e horas estimadas') + ').</p>' +
      '<div class="detalhe-discs">' + discHtml + '</div>' +
      (calc ? '<button type="button" class="botao-secundario det-calc" id="det-calc" style="width:100%;margin:0.2rem 0 0.6rem">' + calc.rotulo + '</button>' : '') +
      '<div class="modal-acoes"><button class="botao-quieto" id="det-fechar">Fechar</button>' +
      '<button id="det-iniciar">' + (carreira ? 'Começar pela carreira' : 'Iniciar plano') + '</button></div>');
    m.classList.add('modal-amplo');
    // O modal contém tabelas longas e o primeiro botão aparece no rodapé. Sem
    // este ajuste, o foco automático do diálogo fazia os detalhes abrirem já no
    // fim da lista, escondendo título, metodologia e métricas.
    setTimeout(function () {
      m.scrollTop = 0;
      try { m.focus({ preventScroll: true }); } catch (err) { m.focus(); }
    }, 0);
    m.querySelector('#det-fechar').addEventListener('click', fecharModal);
    m.querySelector('#det-iniciar').addEventListener('click', function () { criarPlanoDeEdital(e.id); });
    if (calc) m.querySelector('#det-calc').addEventListener('click', function () { abrirCalculadoraRemuneracao(calc); });
  }

  function vereditoConciliacaoHtml(res) {
    const cores = { alta: 'verde', moderada: 'amarelo', baixa: 'alerta', nao_recomendado: 'vermelho' };
    const rotulos = { alta: '✅ Compatibilidade alta', moderada: '🟡 Compatibilidade moderada', baixa: '🟠 Compatibilidade baixa', nao_recomendado: '⛔ Não recomendado' };
    const d = res.detalhes;
    function item(rot, val) { return '<div><span class="cm-rotulo">' + rot + '</span><span class="cm-valor">' + val + '</span></div>'; }
    const comuns = (d.disciplinasComuns || []).map(function (x) {
      return '<li><span class="cmp-ok" aria-hidden="true"></span><span>' + esc(x) + '</span></li>';
    }).join('');
    const exclusivos = '<div class="cmp-exclusivos"><span><strong>' + d.exclusivosA + '</strong> exclusivos no 1° edital</span><span><strong>' + d.exclusivosB + '</strong> exclusivos no 2° edital</span></div>';
    return '<div class="cmp-visual">' +
      '<div class="cmp-pensamento conciliar-' + cores[res.nivel] + '"><strong>' + rotulos[res.nivel] + '</strong><p>' + esc(res.mensagem) + '</p></div>' +
      '<div class="cmp-colunas">' +
      '<section class="cmp-col"><span class="cm-rotulo">Disciplinas aproveitáveis</span><ul>' + (comuns || '<li><span class="cmp-vazio">Nenhuma disciplina comum clara.</span></li>') + '</ul></section>' +
      '<section class="cmp-col"><span class="cm-rotulo">⚠️ Pontos de atenção</span>' + exclusivos +
      '<p class="sub">Tópicos em comum: <strong>' + d.topicosComuns + '</strong> (' + d.overlapPct + '%). Quanto maior esse número, mais estudo você reaproveita.</p></section>' +
      '</div>' +
      '<div class="conciliar-grid">' +
      item('Disciplinas em comum', d.nDisciplinasComuns) +
      item('Tópicos em comum', d.topicosComuns + ' (' + d.overlapPct + '%)') +
      item('Economia de estudo', '~' + d.economiaH + 'h') +
      item('Exclusivos de cada', d.exclusivosA + ' / ' + d.exclusivosB) +
      item('Carga semanal exigida', '~' + d.exigidaSemana + 'h') +
      item('Você tem por semana', '~' + d.horasSemana + 'h') +
      item('Até a prova mais próxima', d.provaDefinida ? 'aprox. ' + d.semanasDisponiveis + ' sem' : 'sem data') +
      '</div>' +
      '<p class="sub cmp-bagagem">📚 Esta estimativa é <strong>do zero</strong>. Na configuração do plano você marca o que já domina (sua bagagem) — e a carga e o tempo reais para terminar caem conforme isso.</p>' +
      '</div>';
  }

  function abrirCompararPlanos(idA) {
    const lista = editaisDoCatalogo().filter(function (e) { return !e.arquivado && !ehEditalCombinado(e); });
    const edA = lista.find(function (x) { return x.id === idA; }) || lista[0];
    if (!edA || lista.length < 2) { toast('Cadastre pelo menos dois editais para comparar.', 'erro'); return; }
    const outros = lista.filter(function (x) { return x.id !== edA.id; });
    const opts = outros.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.titulo) + '</option>'; }).join('');
    const m = abrirModal('<h3>Dá para conciliar?</h3>' +
      '<p class="sub">Compara <strong>' + esc(edA.titulo) + '</strong> com outro edital e estima a viabilidade pela sua rotina (~' + horasSemanaDisponiveis() + 'h/semana).</p>' +
      '<label for="cmp-b">Comparar com</label><select id="cmp-b">' + opts + '</select>' +
      '<div id="cmp-resultado" style="margin-top:0.75rem"></div>' +
      '<p class="sub" style="margin-top:0.6rem">O plano combinado une os dois editais num só cronograma, sem tópicos repetidos. O calendário adaptativo distribui os blocos dentro da sua rotina.</p>' +
      '<div class="modal-acoes"><button class="botao-quieto" id="cmp-fechar">Fechar</button>' +
      '<button id="cmp-combinar">Gerar plano combinado</button></div>');
    m.classList.add('modal-amplo');
    const sel = m.querySelector('#cmp-b');
    const resEl = m.querySelector('#cmp-resultado');
    function recalc() {
      const edB = outros.find(function (x) { return x.id === sel.value; });
      if (!edB) return;
      resEl.innerHTML = vereditoConciliacaoHtml(D.conciliarPlanos(edA, edB, { horasSemana: horasSemanaDisponiveis() }));
    }
    sel.addEventListener('change', recalc);
    m.querySelector('#cmp-fechar').addEventListener('click', fecharModal);
    m.querySelector('#cmp-combinar').addEventListener('click', function () {
      const edB = outros.find(function (x) { return x.id === sel.value; });
      if (!edB) return;
      const r = D.conciliarPlanos(edA, edB, { horasSemana: horasSemanaDisponiveis() });
      if (r.nivel === 'nao_recomendado') {
        confirmar({ titulo: 'Compatibilidade baixa', mensagem: 'Seriam ~' + r.detalhes.exigidaSemana + 'h/semana exigidas vs ~' + r.detalhes.horasSemana + 'h disponíveis. Gerar o plano combinado mesmo assim?', confirmar: 'Gerar mesmo assim', icone: '⚠️' }).then(function (ok) {
          if (ok) gerarPlanoCombinado(edA, edB);
        });
        return;
      }
      gerarPlanoCombinado(edA, edB);
    });
    recalc();
  }

  // Une dois editais conciliáveis num plano único. Antes de gerar, pergunta se o
  // aluno quer dar ênfase a um dos concursos (priorizar o principal sem largar o
  // outro) — depois gera o cronograma adaptativo.
  function gerarPlanoCombinado(edA, edB) {
    const comb = D.combinarEditais(edA, edB);
    abrirEscolhaEnfase(comb, edA, edB);
  }

  // Monta o objeto de ênfase a partir da escolha do aluno (ou null = igual).
  function montarEnfase(comb, principalRotulo) {
    if (!principalRotulo) return null;
    const ehA = principalRotulo === comb.rotulos.a;
    return {
      principal: ehA ? comb.rotulos.a : comb.rotulos.b,
      secundario: ehA ? comb.rotulos.b : comb.rotulos.a,
      split: 0.7,
      provaSecundario: ehA ? comb.rotulos.provaB : comb.rotulos.provaA
    };
  }

  function abrirEscolhaEnfase(comb, edA, edB) {
    const rA = comb.rotulos.a, rB = comb.rotulos.b;
    const opcao = function (val, titulo, sub) {
      return '<label class="enf-op"><input type="radio" name="enf-principal" value="' + esc(val) + '">' +
        '<span class="enf-op-txt"><strong>' + esc(titulo) + '</strong><span class="sub">' + esc(sub) + '</span></span></label>';
    };
    const m = abrirModal(
      '<h3>Combinar concursos</h3>' +
      '<p class="sub">Quer dar ênfase a um deles? Útil quando um é o seu foco e o outro é uma oportunidade do momento — sem largar o principal.</p>' +
      '<div class="enf-opcoes">' +
      opcao('', 'Estudar os dois por igual', 'Tempo dividido por peso e incidência das matérias (padrão).') +
      opcao(rA, 'Priorizar ' + rA, 'A maior parte do tempo vai para ' + rA + '.') +
      opcao(rB, 'Priorizar ' + rB, 'A maior parte do tempo vai para ' + rB + '.') +
      '</div>' +
      '<div class="enf-split oculto" id="enf-split-box"><label>Quanto do tempo para o principal?' +
      '<select id="enf-split"><option value="0.7">70% principal · 30% secundário</option>' +
      '<option value="0.6">60% principal · 40% secundário</option>' +
      '<option value="0.8">80% principal · 20% secundário</option></select></label>' +
      '<p class="sub">O conteúdo em comum vale para os dois. Quando a prova do concurso secundário passar, o foco volta 100% ao principal.</p></div>' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="enf-cancelar">Cancelar</button>' +
      '<button type="button" id="enf-gerar">Gerar plano combinado</button></div>'
    );
    const splitBox = m.querySelector('#enf-split-box');
    m.querySelectorAll('input[name="enf-principal"]').forEach(function (r) {
      r.addEventListener('change', function () { splitBox.classList.toggle('oculto', !r.value); });
    });
    m.querySelector('input[name="enf-principal"]').checked = true; // "igual" por padrão
    m.querySelector('#enf-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#enf-gerar').addEventListener('click', function () {
      const sel = m.querySelector('input[name="enf-principal"]:checked');
      const enfase = montarEnfase(comb, sel ? sel.value : '');
      if (enfase) enfase.split = parseFloat(m.querySelector('#enf-split').value) || 0.7;
      executarPlanoCombinado(comb, edA, edB, enfase);
    });
  }

  async function executarPlanoCombinado(comb, edA, edB, enfase) {
    gerarIdsEdital(comb.disciplinas);
    const reg = Object.assign(
      // ocultoNoCatalogo: o edital combinado é um artefato do plano do aluno, não
      // um edital do catálogo — fica disponível por id (p/ criar/atualizar o
      // plano), mas NÃO aparece na vitrine da aba Planos.
      { id: window.Store.novoId('edt'), criadoEm: D.hojeISO(), orgao: '', cargo: '', area: '', estado: '', emAlta: false, arquivado: false, ocultoNoCatalogo: true },
      comb
    );
    state.editais.push(reg);
    comparacaoIds = []; // some o estado "✓ Comparando" dos editais selecionados
    salvar();
    fecharModal();
    await criarPlanoDeEdital(reg.id); // valida, cria o plano, ativa e abre o ajuste de rotina
    // marca o plano como combinado (a aba Edital usa isso para mostrar
    // compatibilidade + tags de origem — só quando há de fato 2 concursos)
    if (state.plano) {
      const compat = D.conciliarPlanos(edA, edB, { horasSemana: horasSemanaDisponiveis() });
      state.plano.combinado = {
        fontes: [tituloCurto(edA.titulo), tituloCurto(edB.titulo)],
        pct: compat.detalhes.overlapPct,
        nivel: compat.nivel,
        mensagem: compat.mensagem,
        rotulos: comb.rotulos // permite reabrir o ajuste de ênfase depois
      };
      if (enfase) state.plano.enfase = enfase; else delete state.plano.enfase;
      salvar();
    }
  }

  // ================= Editor/conferência de edital (admin) =================
  let editorEdital = null;
  let editorTipo = 'edital';

  function topicoEmBranco() {
    return { id: '', nome: '', incidencia_pct: 0, prioridade: 2, horas_estimadas: 2, semana_sugerida: null, status: 'pendente', reaberto: false, orfao: false };
  }
  function disciplinaEmBranco() {
    return { id: '', nome: '', cor: '#3B82F6', peso: 1, dificuldade: 'media', base_teorica: 'pdf', topicos: [topicoEmBranco()] };
  }
  function editalEmBranco() {
    return { id: null, titulo: '', banca: '', orgao: '', cargo: '', area: '', estado: '', nivel: 'medio', notaCorte: 70, tipoCorte: 'ampla', cortes: { ampla: 70, negros: null, pcd: null }, emAlta: false, arquivado: false, foto: '', janelaProva: { inicio: '', fim: '' }, salario: '', beneficios: '', vagas: '', disciplinas: [] };
  }
  function carreiraEmBranco() {
    const primeiraDisciplina = disciplinaEmBranco();
    primeiraDisciplina.topicos[0].incidencia_pct = 100;
    return {
      id: null, tipoCatalogo: 'carreira', titulo: '', banca: 'Base personalizada',
      orgao: '', cargo: '', area: 'Administrativa', estado: '', nivel: 'medio',
      notaCorte: 80, tipoCorte: 'ampla', cortes: { ampla: 80, negros: null, pcd: null },
      emAlta: false, arquivado: false, foto: '', janelaProva: { inicio: '', fim: '' },
      cobertura: 'Nacional', metodologia: '', baseEditais: [], fontesResumo: '',
      salario: '', beneficios: '', vagas: '', disciplinas: [primeiraDisciplina]
    };
  }

  const LISTAS_CORTE = { ampla: 'Ampla concorrência', negros: 'Cota negros', pcd: 'Cota PcD', indigenas: 'Cota indígenas' };
  function normalizarListaCorte(v) {
    const s = String(v || '').toLowerCase();
    if (s.indexOf('negr') >= 0) return 'negros';
    if (s.indexOf('pcd') >= 0 || s.indexOf('defici') >= 0) return 'pcd';
    if (s.indexOf('ind') >= 0) return 'indigenas';
    return 'ampla';
  }

  // Lê uma imagem e devolve um data URL já redimensionado (evita estourar o
  // localStorage / a sincronização com fotos gigantes).
  function arquivoParaImagemData(file, max) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload = function () {
        const img = new Image();
        img.onload = function () {
          const escala = Math.min(1, (max || 480) / (img.width || 1));
          const w = Math.max(1, Math.round(img.width * escala));
          const hh = Math.max(1, Math.round(img.height * escala));
          try {
            const cv = document.createElement('canvas');
            cv.width = w; cv.height = hh;
            cv.getContext('2d').drawImage(img, 0, 0, w, hh);
            resolve(cv.toDataURL('image/jpeg', 0.82));
          } catch (e) { resolve(fr.result); }
        };
        img.onerror = function () { resolve(fr.result); };
        img.src = fr.result;
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }
  function normalizarEditalParaEditor(e) {
    const c = JSON.parse(JSON.stringify(e || {}));
    if (!c.janelaProva || typeof c.janelaProva !== 'object') c.janelaProva = { inicio: '', fim: '' };
    c.janelaProva.inicio = c.janelaProva.inicio || '';
    c.janelaProva.fim = c.janelaProva.fim || '';
    c.nivel = c.nivel || 'medio';
    // Cortes por modalidade (ampla/negros/pcd). Editais antigos só têm notaCorte:
    // herda a ampla a partir dele para não perder o dado.
    if (!c.cortes || typeof c.cortes !== 'object') c.cortes = {};
    c.cortes = {
      ampla: c.cortes.ampla != null ? c.cortes.ampla : (c.notaCorte != null ? c.notaCorte : null),
      negros: c.cortes.negros != null ? c.cortes.negros : null,
      pcd: c.cortes.pcd != null ? c.cortes.pcd : null
    };
    c.disciplinas = (c.disciplinas || []).map(function (d) {
      return {
        id: d.id || '', nome: d.nome || '', cor: d.cor || '#3B82F6', peso: d.peso || 1,
        dificuldade: d.dificuldade || 'media', base_teorica: d.base_teorica || 'pdf',
        // visão geral do edital: caráter e nota mínima por disciplina (opcionais)
        carater: d.carater || '',
        nota_minima_pct: (d.nota_minima_pct != null && d.nota_minima_pct !== '') ? d.nota_minima_pct : null,
        topicos: (d.topicos || []).map(function (t) {
          return {
            id: t.id || '', nome: t.nome || '', incidencia_pct: t.incidencia_pct || 0,
            prioridade: t.prioridade || 2, horas_estimadas: t.horas_estimadas || 2,
            semana_sugerida: t.semana_sugerida || null, status: t.status || 'pendente',
            reaberto: !!t.reaberto, orfao: !!t.orfao
          };
        })
      };
    });
    return c;
  }

  function siglaDe(nome) {
    const limpo = String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, '');
    const palavras = limpo.split(/\s+/).filter(Boolean);
    let s = palavras.length >= 2 ? palavras.map(function (p) { return p[0]; }).join('') : limpo.replace(/\s/g, '');
    s = s.slice(0, 4);
    return s || 'DIS';
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function gerarIdsEdital(disciplinas) {
    const usadosD = {}, usadosT = {};
    disciplinas.forEach(function (d) {
      let base = (d.id && /^[A-Z0-9]+$/.test(String(d.id))) ? d.id : siglaDe(d.nome);
      let id = base, n = 2;
      while (usadosD[id]) { id = base + n; n++; }
      usadosD[id] = true; d.id = id;
      (d.topicos || []).forEach(function (t, i) {
        let tid = (t.id && /^[A-Za-z0-9_-]+$/.test(String(t.id)) && !usadosT[t.id]) ? t.id : (id + '-' + pad2(i + 1));
        let k = 2;
        while (usadosT[tid]) { tid = id + '-' + pad2(i + 1) + '-' + k; k++; }
        usadosT[tid] = true; t.id = tid;
      });
    });
  }

  function editorCarreiraBody() {
    const e = editorEdital;
    const nivelAtual = nivelEdital(e);
    const nivelOpts = ['fundamental', 'medio', 'tecnico', 'superior'].map(function (k) {
      return '<option value="' + k + '"' + (nivelAtual === k ? ' selected' : '') + '>' + NIVEIS_EDITAL[k] + '</option>';
    }).join('');
    let h = '<div class="editor-carreira-intro"><strong>Estrutura da carreira</strong>' +
      '<p class="sub">Use a prioridade percentual para indicar o que merece mais atenção dentro de cada disciplina. A ordem define a sequência da primeira passada; tudo pode ser ajustado a qualquer momento.</p></div>' +
      '<div class="grade-2">' +
      '<div><label>Nome da carreira</label><input id="ee-titulo" type="text" value="' + esc(e.titulo) + '" placeholder="Ex.: Carreira Fiscal · Área Administrativa"></div>' +
      '<div><label>Base de provas / bancas</label><input id="ee-banca" type="text" value="' + esc(e.banca || '') + '" placeholder="Ex.: Multibanca · últimos editais"></div></div>' +
      '<div class="grade-3">' +
      '<div><label>Órgão ou ramo</label><input id="ee-orgao" type="text" value="' + esc(e.orgao || '') + '" placeholder="Ex.: Fiscos estaduais"></div>' +
      '<div><label>Cargo-alvo</label><input id="ee-cargo" type="text" value="' + esc(e.cargo || '') + '" placeholder="Ex.: Técnico Fazendário"></div>' +
      '<div><label>Área</label><input id="ee-area" type="text" value="' + esc(e.area || '') + '" placeholder="Ex.: Administrativa"></div></div>' +
      '<div class="grade-3">' +
      '<div><label>Cobertura</label><input id="ee-cobertura" type="text" value="' + esc(e.cobertura || 'Nacional') + '" placeholder="Ex.: Nacional"></div>' +
      '<div><label>Escolaridade</label><select id="ee-nivel">' + nivelOpts + '</select></div>' +
      '<div><label>Meta inicial de acerto (%)</label><input id="ee-corte-ampla" type="number" min="1" max="100" value="' + (e.notaCorte || 80) + '"></div></div>' +
      '<div class="grade-2">' +
      '<div><label>Como esta carreira foi montada</label><textarea id="ee-metodologia" rows="4" placeholder="Explique o critério usado para selecionar e priorizar os conteúdos.">' + esc(e.metodologia || '') + '</textarea></div>' +
      '<div><label>Editais usados como base</label><textarea id="ee-base-editais" rows="4" placeholder="Um por linha ou separados por vírgula">' + esc((e.baseEditais || []).join('\n')) + '</textarea></div></div>' +
      '<label>Resumo das fontes</label><input id="ee-fontes-resumo" type="text" value="' + esc(e.fontesResumo || '') + '" placeholder="Ex.: editais oficiais e análise de questões">' +
      '<div class="ee-foto-campo"><label>Foto / capa da carreira (aparece na aba Planos)</label>' +
      '<div class="ee-foto-linha">' +
      '<span class="catalogo-foto' + (e.foto ? '' : ' catalogo-foto-placeholder') + '" id="ee-foto-preview">' +
      (e.foto ? '<img src="' + esc(e.foto) + '" alt="">' : 'IMG') + '</span>' +
      '<input type="file" id="ee-foto" accept="image/*">' +
      (e.foto ? '<button type="button" class="botao-mini botao-quieto" id="ee-foto-remover">Remover foto</button>' : '') +
      '</div></div><div class="editor-discs">';

    e.disciplinas.forEach(function (d, di) {
      h += '<div class="editor-disc" data-di="' + di + '"><div class="editor-disc-cab">' +
        '<input class="ed-d-nome" data-di="' + di + '" type="text" value="' + esc(d.nome) + '" placeholder="Disciplina">' +
        '<input class="ed-d-cor" data-di="' + di + '" type="color" value="' + esc(/^#/.test(d.cor) ? d.cor : '#3B82F6') + '" title="Cor">' +
        '<label class="mini-rot">peso<input class="ed-d-peso" data-di="' + di + '" type="number" min="1" max="5" value="' + (d.peso || 1) + '"></label>' +
        '<select class="ed-d-dif" data-di="' + di + '">' +
        ['facil', 'media', 'dificil'].map(function (k) { return '<option value="' + k + '"' + (d.dificuldade === k ? ' selected' : '') + '>' + (k === 'facil' ? 'Fácil' : k === 'media' ? 'Média' : 'Difícil') + '</option>'; }).join('') +
        '</select>' +
        '<button class="botao-mini botao-quieto" data-rem-disc="' + di + '">remover</button></div>' +
        '<div class="editor-topicos-scroll"><table class="editor-topicos"><thead><tr><th>Tópico</th><th>Prior.%</th><th>Faixa</th><th>Ordem</th><th>Horas</th><th></th></tr></thead><tbody>';
      d.topicos.forEach(function (t, ti) {
        h += '<tr>' +
          '<td><input class="ed-t-nome" data-di="' + di + '" data-ti="' + ti + '" type="text" value="' + esc(t.nome) + '"></td>' +
          '<td><input class="ed-t-inc" data-di="' + di + '" data-ti="' + ti + '" type="number" min="0" max="100" value="' + (t.incidencia_pct || 0) + '"></td>' +
          '<td><input class="ed-t-pri" data-di="' + di + '" data-ti="' + ti + '" type="number" min="1" max="3" value="' + (t.prioridade || 2) + '"></td>' +
          '<td><input class="ed-t-sem" data-di="' + di + '" data-ti="' + ti + '" type="number" min="1" max="52" value="' + (t.semana_sugerida || (ti + 1)) + '"></td>' +
          '<td><input class="ed-t-hor" data-di="' + di + '" data-ti="' + ti + '" type="number" min="1" max="120" value="' + (t.horas_estimadas || 2) + '"></td>' +
          '<td><button class="botao-mini botao-quieto" data-rem-top="' + di + '_' + ti + '" title="Remover tópico">×</button></td></tr>';
      });
      h += '</tbody></table></div><button class="botao-mini botao-quieto" data-add-top="' + di + '">+ tópico</button></div>';
    });
    h += '</div><button class="botao-secundario botao-mini" id="ee-add-disc">+ Adicionar disciplina</button>';
    return h;
  }

  function editorEditalBody() {
    if (editorTipo === 'carreira') return editorCarreiraBody();
    const e = editorEdital;
    const nivelEscolaridadeOpts = ['fundamental', 'medio', 'tecnico', 'superior'];
    const nivelAtual = nivelEdital(e);
    const nivelOpts = nivelEscolaridadeOpts.map(function (k) {
      return '<option value="' + k + '"' + (nivelAtual === k ? ' selected' : '') + '>' + NIVEIS_EDITAL[k] + '</option>';
    }).join('');
    const cortes = e.cortes || {};
    const cAmpla = cortes.ampla != null ? cortes.ampla : (e.notaCorte != null ? e.notaCorte : 70);
    const cNeg = cortes.negros != null ? cortes.negros : '';
    const cPcd = cortes.pcd != null ? cortes.pcd : '';
    let h = '<div class="grade-2">' +
      '<div><label>Nome do edital</label><input id="ee-titulo" type="text" value="' + esc(e.titulo) + '" placeholder="Ex.: TRF3 Técnico Judiciário 2026"></div>' +
      '<div><label>Banca</label><input id="ee-banca" type="text" value="' + esc(e.banca) + '" placeholder="Ex.: FCC"></div></div>' +
      '<div class="grade-3">' +
      '<div><label>Órgão</label><input id="ee-orgao" type="text" value="' + esc(e.orgao) + '"></div>' +
      '<div><label>Cargo</label><input id="ee-cargo" type="text" value="' + esc(e.cargo) + '"></div>' +
      '<div><label>Área</label><input id="ee-area" type="text" value="' + esc(e.area || '') + '" placeholder="Ex.: Administrativa"></div></div>' +
      '<div class="grade-3">' +
      '<div><label>Estado (UF)</label><input id="ee-estado" type="text" maxlength="2" value="' + esc(e.estado) + '" style="text-transform:uppercase"></div>' +
      '<div><label>Escolaridade</label><select id="ee-nivel">' + nivelOpts + '</select></div>' +
      '<div><label>Destaque</label><label class="check-inline"><input id="ee-emalta" type="checkbox"' + (e.emAlta ? ' checked' : '') + '> em alta no catálogo</label></div></div>' +
      '<div class="ee-cortes-grupo"><span class="ee-grupo-rotulo">' + (e.metaDesempenho ? 'Meta inicial de desempenho (%)' : 'Notas de corte do último aprovado (%)') + '</span>' +
      '<div class="grade-3">' +
      '<div><label>' + (e.metaDesempenho ? 'Meta principal' : 'Ampla concorrência') + '</label><input id="ee-corte-ampla" type="number" min="0" max="100" value="' + cAmpla + '"></div>' +
      '<div><label>Cota negros (CN)</label><input id="ee-corte-negros" type="number" min="0" max="100" value="' + cNeg + '" placeholder="—"></div>' +
      '<div><label>Cota PcD</label><input id="ee-corte-pcd" type="number" min="0" max="100" value="' + cPcd + '" placeholder="—"></div>' +
      '</div></div>' +
      '<div class="grade-2">' +
      '<div><label>Janela da prova — início</label>' + seletorMesHtml('ee-janela-ini', e.janelaProva.inicio, { opcional: true }) + '</div>' +
      '<div><label>Janela da prova — fim</label>' + seletorMesHtml('ee-janela-fim', e.janelaProva.fim, { opcional: true }) + '</div></div>' +
      '<div class="grade-3">' +
      '<div><label>Salário</label><input id="ee-salario" type="text" value="' + esc(e.salario || '') + '" placeholder="Ex.: R$ 5.878,82"></div>' +
      '<div><label>Vagas</label><input id="ee-vagas" type="text" value="' + esc(e.vagas || '') + '" placeholder="Ex.: 228 + CR"></div>' +
      '<div><label>Benefícios</label><input id="ee-beneficios" type="text" value="' + esc(e.beneficios || '') + '" placeholder="Ex.: VR, plano de saúde"></div>' +
      '</div>';

    h += '<div class="ee-foto-campo"><label>Foto / capa do plano (aparece na aba Planos)</label>' +
      '<div class="ee-foto-linha">' +
      '<span class="catalogo-foto' + (e.foto ? '' : ' catalogo-foto-placeholder') + '" id="ee-foto-preview">' +
      (e.foto ? '<img src="' + esc(e.foto) + '" alt="">' : 'IMG') + '</span>' +
      '<input type="file" id="ee-foto" accept="image/*">' +
      (e.foto ? '<button type="button" class="botao-mini botao-quieto" id="ee-foto-remover">Remover foto</button>' : '') +
      '</div></div>';

    h += '<div class="editor-discs">';
    e.disciplinas.forEach(function (d, di) {
      h += '<div class="editor-disc" data-di="' + di + '"><div class="editor-disc-cab">' +
        '<input class="ed-d-nome" data-di="' + di + '" type="text" value="' + esc(d.nome) + '" placeholder="Disciplina">' +
        '<input class="ed-d-cor" data-di="' + di + '" type="color" value="' + esc(/^#/.test(d.cor) ? d.cor : '#3B82F6') + '" title="Cor">' +
        '<label class="mini-rot">peso<input class="ed-d-peso" data-di="' + di + '" type="number" min="1" max="5" value="' + (d.peso || 1) + '"></label>' +
        '<select class="ed-d-dif" data-di="' + di + '">' +
        ['facil', 'media', 'dificil'].map(function (k) { return '<option value="' + k + '"' + (d.dificuldade === k ? ' selected' : '') + '>' + (k === 'facil' ? 'Fácil' : k === 'media' ? 'Média' : 'Difícil') + '</option>'; }).join('') +
        '</select>' +
        '<button class="botao-mini botao-quieto" data-rem-disc="' + di + '">remover</button></div>' +
        '<table class="editor-topicos"><thead><tr><th>Tópico</th><th>Incid.%</th><th>Prior.</th><th>Ordem</th><th>Horas</th><th></th></tr></thead><tbody>';
      d.topicos.forEach(function (t, ti) {
        h += '<tr>' +
          '<td><input class="ed-t-nome" data-di="' + di + '" data-ti="' + ti + '" type="text" value="' + esc(t.nome) + '"></td>' +
          '<td><input class="ed-t-inc" data-di="' + di + '" data-ti="' + ti + '" type="number" min="0" max="100" value="' + (t.incidencia_pct || 0) + '"></td>' +
          '<td><input class="ed-t-pri" data-di="' + di + '" data-ti="' + ti + '" type="number" min="1" max="3" value="' + (t.prioridade || 2) + '"></td>' +
          '<td><input class="ed-t-sem" data-di="' + di + '" data-ti="' + ti + '" type="number" min="1" max="52" value="' + (t.semana_sugerida || (ti + 1)) + '"></td>' +
          '<td><input class="ed-t-hor" data-di="' + di + '" data-ti="' + ti + '" type="number" min="1" max="40" value="' + (t.horas_estimadas || 2) + '"></td>' +
          '<td><button class="botao-mini botao-quieto" data-rem-top="' + di + '_' + ti + '" title="Remover tópico">×</button></td></tr>';
      });
      h += '</tbody></table><button class="botao-mini botao-quieto" data-add-top="' + di + '">+ tópico</button></div>';
    });
    h += '</div>';
    h += '<button class="botao-secundario botao-mini" id="ee-add-disc">+ Adicionar disciplina</button>';
    return h;
  }

  function sincronizarEditorDoDom(body) {
    const e = editorEdital;
    function val(sel) { const x = body.querySelector(sel); return x ? x.value : ''; }
    e.titulo = val('#ee-titulo').trim();
    e.banca = val('#ee-banca').trim();
    e.orgao = val('#ee-orgao').trim();
    e.cargo = val('#ee-cargo').trim();
    e.area = val('#ee-area').trim();
    if (body.querySelector('#ee-cobertura')) e.cobertura = val('#ee-cobertura').trim() || 'Nacional';
    if (body.querySelector('#ee-metodologia')) e.metodologia = val('#ee-metodologia').trim();
    if (body.querySelector('#ee-fontes-resumo')) e.fontesResumo = val('#ee-fontes-resumo').trim();
    if (body.querySelector('#ee-base-editais')) {
      e.baseEditais = val('#ee-base-editais').split(/[\n;,]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    }
    e.estado = val('#ee-estado').trim().toUpperCase().slice(0, 2);
    e.nivel = val('#ee-nivel') || 'medio';
    const clampPct = function (v) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null; };
    const cAmpla = clampPct(val('#ee-corte-ampla'));
    e.cortes = {
      ampla: cAmpla != null ? cAmpla : 70,
      negros: val('#ee-corte-negros').trim() === '' ? null : clampPct(val('#ee-corte-negros')),
      pcd: val('#ee-corte-pcd').trim() === '' ? null : clampPct(val('#ee-corte-pcd'))
    };
    // A ampla é a meta principal de estudo (corte_pct dos planos).
    e.notaCorte = e.cortes.ampla;
    e.tipoCorte = 'ampla';
    e.janelaProva.inicio = val('#ee-janela-ini');
    e.janelaProva.fim = val('#ee-janela-fim');
    e.salario = val('#ee-salario').trim();
    e.vagas = val('#ee-vagas').trim();
    e.beneficios = val('#ee-beneficios').trim();
    const chk = body.querySelector('#ee-emalta');
    e.emAlta = !!(chk && chk.checked);
    body.querySelectorAll('.ed-d-nome').forEach(function (inp) { const di = +inp.getAttribute('data-di'); if (e.disciplinas[di]) e.disciplinas[di].nome = inp.value; });
    body.querySelectorAll('.ed-d-cor').forEach(function (inp) { const di = +inp.getAttribute('data-di'); if (e.disciplinas[di]) e.disciplinas[di].cor = inp.value; });
    body.querySelectorAll('.ed-d-peso').forEach(function (inp) { const di = +inp.getAttribute('data-di'); if (e.disciplinas[di]) e.disciplinas[di].peso = Math.max(1, parseInt(inp.value, 10) || 1); });
    body.querySelectorAll('.ed-d-dif').forEach(function (inp) { const di = +inp.getAttribute('data-di'); if (e.disciplinas[di]) e.disciplinas[di].dificuldade = inp.value; });
    body.querySelectorAll('.ed-t-nome').forEach(function (inp) { const d = +inp.getAttribute('data-di'), t = +inp.getAttribute('data-ti'); if (e.disciplinas[d] && e.disciplinas[d].topicos[t]) e.disciplinas[d].topicos[t].nome = inp.value; });
    body.querySelectorAll('.ed-t-inc').forEach(function (inp) { const d = +inp.getAttribute('data-di'), t = +inp.getAttribute('data-ti'); if (e.disciplinas[d] && e.disciplinas[d].topicos[t]) e.disciplinas[d].topicos[t].incidencia_pct = Math.max(0, Math.min(100, parseInt(inp.value, 10) || 0)); });
    body.querySelectorAll('.ed-t-pri').forEach(function (inp) { const d = +inp.getAttribute('data-di'), t = +inp.getAttribute('data-ti'); if (e.disciplinas[d] && e.disciplinas[d].topicos[t]) e.disciplinas[d].topicos[t].prioridade = Math.max(1, Math.min(3, parseInt(inp.value, 10) || 2)); });
    body.querySelectorAll('.ed-t-sem').forEach(function (inp) { const d = +inp.getAttribute('data-di'), t = +inp.getAttribute('data-ti'); if (e.disciplinas[d] && e.disciplinas[d].topicos[t]) e.disciplinas[d].topicos[t].semana_sugerida = Math.max(1, Math.min(52, parseInt(inp.value, 10) || (t + 1))); });
    body.querySelectorAll('.ed-t-hor').forEach(function (inp) { const d = +inp.getAttribute('data-di'), t = +inp.getAttribute('data-ti'); if (e.disciplinas[d] && e.disciplinas[d].topicos[t]) e.disciplinas[d].topicos[t].horas_estimadas = Math.max(1, parseInt(inp.value, 10) || 2); });
  }

  function rerenderEditorBody(m) {
    m.querySelector('#editor-body').innerHTML = editorEditalBody();
    ligarEditorBody(m);
  }
  function ligarEditorBody(m) {
    const body = m.querySelector('#editor-body');
    ligarSeletoresMes(body);
    const fotoInput = body.querySelector('#ee-foto');
    if (fotoInput) fotoInput.addEventListener('change', function () {
      const f = fotoInput.files && fotoInput.files[0];
      if (!f) return;
      arquivoParaImagemData(f, 480).then(function (data) {
        editorEdital.foto = data;
        const prev = body.querySelector('#ee-foto-preview');
        if (prev) { prev.classList.remove('catalogo-foto-placeholder'); prev.innerHTML = '<img src="' + esc(data) + '" alt="">'; }
        if (!body.querySelector('#ee-foto-remover')) {
          const btn = document.createElement('button');
          btn.type = 'button'; btn.className = 'botao-mini botao-quieto'; btn.id = 'ee-foto-remover'; btn.textContent = 'Remover foto';
          fotoInput.parentNode.appendChild(btn);
          btn.addEventListener('click', removerFotoEditor);
        }
      });
    });
    function removerFotoEditor() {
      editorEdital.foto = '';
      const prev = body.querySelector('#ee-foto-preview');
      if (prev) { prev.classList.add('catalogo-foto-placeholder'); prev.innerHTML = 'IMG'; }
      const rem = body.querySelector('#ee-foto-remover');
      if (rem) rem.remove();
      if (fotoInput) fotoInput.value = '';
    }
    const fotoRemInicial = body.querySelector('#ee-foto-remover');
    if (fotoRemInicial) fotoRemInicial.addEventListener('click', removerFotoEditor);
    const addDisc = body.querySelector('#ee-add-disc');
    if (addDisc) addDisc.addEventListener('click', function () {
      sincronizarEditorDoDom(body);
      const nova = disciplinaEmBranco();
      if (editorTipo === 'carreira') nova.topicos[0].incidencia_pct = 100;
      editorEdital.disciplinas.push(nova);
      rerenderEditorBody(m);
    });
    body.querySelectorAll('[data-rem-disc]').forEach(function (b) {
      b.addEventListener('click', function () {
        sincronizarEditorDoDom(body);
        editorEdital.disciplinas.splice(+b.getAttribute('data-rem-disc'), 1);
        rerenderEditorBody(m);
      });
    });
    body.querySelectorAll('[data-add-top]').forEach(function (b) {
      b.addEventListener('click', function () {
        sincronizarEditorDoDom(body);
        editorEdital.disciplinas[+b.getAttribute('data-add-top')].topicos.push(topicoEmBranco());
        rerenderEditorBody(m);
      });
    });
    body.querySelectorAll('[data-rem-top]').forEach(function (b) {
      b.addEventListener('click', function () {
        sincronizarEditorDoDom(body);
        const parts = b.getAttribute('data-rem-top').split('_');
        editorEdital.disciplinas[+parts[0]].topicos.splice(+parts[1], 1);
        rerenderEditorBody(m);
      });
    });
  }

  function abrirEditorEdital(editalId, modo, dadosImport) {
    const baseEditavelPeloAluno = !!(editalId && catalogoEditaisBase.some(function (e) { return e.id === editalId; }));
    if (!usuarioAdmin() && !baseEditavelPeloAluno) { toast('Apenas o administrador pode editar este edital.', 'erro'); return; }
    editorTipo = 'edital';
    let baseObj;
    if (dadosImport) {
      baseObj = Object.assign(editalEmBranco(), {
        titulo: dadosImport.titulo, banca: dadosImport.banca, orgao: dadosImport.orgao,
        cargo: dadosImport.cargo, area: dadosImport.area || '', estado: dadosImport.estado,
        nivel: dadosImport.nivel || 'medio', notaCorte: dadosImport.notaCorte,
        tipoCorte: normalizarListaCorte(dadosImport.tipoCorte),
        cortes: dadosImport.cortes || { ampla: dadosImport.notaCorte, negros: null, pcd: null },
        janelaProva: dadosImport.janelaProva || { inicio: '', fim: '' },
        emAlta: !!dadosImport.emAlta,
        salario: dadosImport.salario || '', beneficios: dadosImport.beneficios || '', vagas: dadosImport.vagas || '',
        disciplinas: dadosImport.disciplinas
      });
    } else if (editalId) {
      baseObj = editalPorId(editalId) || editalEmBranco();
    } else {
      baseObj = editalEmBranco();
      baseObj.disciplinas = [disciplinaEmBranco()];
    }
    editorEdital = normalizarEditalParaEditor(baseObj);
    editorEdital._editId = (!dadosImport && editalId && !baseObj._global && !baseObj._base) ? editalId : null;
    editorEdital._globalId = (!dadosImport && editalId && (baseObj._global || baseObj._base)) ? editalId : null;
    const titulo = modo === 'conferencia' ? 'Conferência da importação'
      : (editorEdital._editId ? 'Editar edital' : (editorEdital._globalId ? (baseEditavelPeloAluno ? 'Personalizar plano' : 'Personalizar edital') : 'Novo edital'));
    const dica = modo === 'conferencia'
      ? '<p class="sub">Confira as disciplinas, pesos e incidências sugeridos. Ajuste o que precisar e confirme.</p>'
      : (!usuarioAdmin() && baseEditavelPeloAluno ? '<p class="sub">Sua versão ficará somente na sua conta; o modelo original poderá ser restaurado quando quiser.</p>' : '');
    const m = abrirModal('<h3>' + titulo + '</h3>' + dica +
      '<div id="editor-body">' + editorEditalBody() + '</div>' +
      '<div class="modal-acoes"><button class="botao-quieto" id="editor-cancelar">Cancelar</button>' +
      '<button id="editor-salvar">' + (modo === 'conferencia' ? 'Confirmar e salvar' : (baseEditavelPeloAluno ? 'Salvar plano' : 'Salvar edital')) + '</button></div>');
    m.classList.add('modal-amplo');
    ligarEditorBody(m);
    m.querySelector('#editor-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#editor-salvar').addEventListener('click', function () { salvarEditorEdital(m); });
  }

  function salvarEditorEdital(m) {
    const baseEditavelPeloAluno = !!(editorEdital && editorEdital._globalId && catalogoEditaisBase.some(function (x) { return x.id === editorEdital._globalId; }));
    if (!usuarioAdmin() && !baseEditavelPeloAluno) { toast('Apenas o administrador pode salvar este edital.', 'erro'); return; }
    sincronizarEditorDoDom(m.querySelector('#editor-body'));
    const e = editorEdital;
    if (!e.titulo) { toast('Dê um nome ao edital.', 'erro'); return; }
    const disciplinas = e.disciplinas
      .map(function (d) { return Object.assign({}, d, { topicos: (d.topicos || []).filter(function (t) { return (t.nome || '').trim(); }) }); })
      .filter(function (d) { return (d.nome || '').trim() && d.topicos.length; });
    if (!disciplinas.length) { toast('Adicione ao menos uma disciplina com um tópico.', 'erro'); return; }
    gerarIdsEdital(disciplinas);
    const teste = { versao: 1, plano: { concurso: e.titulo, banca: e.banca, meta: { corte_pct: e.notaCorte } }, disciplinas: disciplinas };
    const v = D.validarPlano(teste);
    if (!v.ok) { toast('Não consegui validar: ' + v.erros[0], 'erro'); return; }
    const registro = {
      titulo: e.titulo, banca: e.banca, orgao: e.orgao, cargo: e.cargo, area: e.area,
      estado: e.estado, nivel: e.nivel, notaCorte: e.notaCorte, tipoCorte: normalizarListaCorte(e.tipoCorte),
      cortes: e.cortes || { ampla: e.notaCorte, negros: null, pcd: null }, emAlta: e.emAlta,
      metaDesempenho: !!e.metaDesempenho,
      foto: e.foto || '',
      salario: e.salario || '', beneficios: e.beneficios || '', vagas: e.vagas || '',
      fonte: e.fonte || '', observacoes: e.observacoes || '',
      // carimbo de versão: muda a cada save e dispara o aviso de "atualizar plano"
      // nos planos criados a partir deste edital.
      atualizadoEm: new Date().toISOString(),
      arquivado: !!e.arquivado, janelaProva: { inicio: e.janelaProva.inicio || '', fim: e.janelaProva.fim || '' },
      disciplinas: disciplinas
    };
    if (e._editId) {
      const alvo = state.editais.find(function (x) { return x.id === e._editId; });
      if (alvo) Object.assign(alvo, registro);
    } else {
      registro.id = e._globalId || window.Store.novoId('edt');
      registro.criadoEm = D.hojeISO();
      state.editais = state.editais.filter(function (x) { return x.id !== registro.id; });
      state.editais.push(registro);
    }
    salvar();
    if (usuarioAdmin()) publicarCatalogoAdmin({ toast: true });
    fecharModal();
    render();
    toast((baseEditavelPeloAluno ? 'Plano salvo: ' : 'Edital salvo: ') + v.resumo.disciplinas + ' disciplinas, ' + v.resumo.topicos + ' tópicos', 'sucesso');
  }

  function abrirEditorCarreira(carreiraId) {
    editorTipo = 'carreira';
    const existente = carreiraId ? carreiraPorId(carreiraId) : null;
    editorEdital = normalizarEditalParaEditor(existente || carreiraEmBranco());
    editorEdital._editId = carreiraId || null;
    const personalizada = existente && (usuarioAdmin() ? existente._carreiraGlobal : existente._carreiraPessoal);
    const titulo = !existente ? 'Nova carreira'
      : (carreiraBasePorId(carreiraId) && !personalizada ? 'Personalizar carreira' : 'Editar carreira');
    const dica = usuarioAdmin()
      ? '<p class="sub">Ao salvar, a carreira será publicada na aba Planos para todos os alunos. O modelo distribuído com o app poderá ser restaurado quando quiser.</p>'
      : (carreiraBasePorId(carreiraId) && !personalizada
        ? '<p class="sub">Ao salvar, o modelo original continua preservado. Você poderá restaurá-lo quando quiser.</p>'
        : '<p class="sub">A carreira ficará disponível na aba Planos somente para a sua conta.</p>');
    const m = abrirModal('<h3>' + titulo + '</h3>' + dica +
      '<div id="editor-body">' + editorEditalBody() + '</div>' +
      '<div class="modal-acoes"><button class="botao-quieto" id="editor-cancelar">Cancelar</button>' +
      '<button id="editor-salvar">Salvar carreira</button></div>');
    m.classList.add('modal-amplo');
    ligarEditorBody(m);
    m.querySelector('#editor-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#editor-salvar').addEventListener('click', function () { salvarEditorCarreira(m); });
  }

  function salvarEditorCarreira(m) {
    sincronizarEditorDoDom(m.querySelector('#editor-body'));
    const e = editorEdital;
    if (!e.titulo) { toast('Dê um nome à carreira.', 'erro'); return; }
    const disciplinas = e.disciplinas
      .map(function (d) {
        return Object.assign({}, d, {
          topicos: (d.topicos || []).filter(function (t) { return (t.nome || '').trim(); })
        });
      })
      .filter(function (d) { return (d.nome || '').trim() && d.topicos.length; });
    if (!disciplinas.length) {
      toast('Adicione ao menos uma disciplina com um tópico.', 'erro');
      return;
    }
    gerarIdsEdital(disciplinas);
    const teste = {
      versao: 1,
      plano: { concurso: e.titulo, banca: e.banca || '', meta: { corte_pct: e.notaCorte || 80 } },
      disciplinas: disciplinas
    };
    const v = D.validarPlano(teste);
    if (!v.ok) { toast('Não consegui validar: ' + v.erros[0], 'erro'); return; }

    const admin = usuarioAdmin();
    const lista = admin ? carreirasGlobais() : carreirasPersonalizadas();
    const anterior = e._editId ? lista.find(function (x) { return x.id === e._editId; }) : null;
    const id = e._editId || window.Store.novoId('carreira');
    const registro = {
      id: id,
      tipoCatalogo: 'carreira',
      titulo: e.titulo,
      banca: e.banca || 'Base personalizada',
      orgao: e.orgao || '',
      cargo: e.cargo || '',
      area: e.area || '',
      estado: '',
      cobertura: e.cobertura || 'Nacional',
      nivel: e.nivel || 'medio',
      notaCorte: e.notaCorte || 80,
      tipoCorte: 'ampla',
      cortes: { ampla: e.notaCorte || 80, negros: null, pcd: null },
      foto: e.foto || '',
      metodologia: e.metodologia || 'Plano de carreira criado e priorizado manualmente pelo aluno.',
      baseEditais: Array.isArray(e.baseEditais) ? e.baseEditais : [],
      fontesResumo: e.fontesResumo || 'Conteúdo e prioridades definidos manualmente.',
      emAlta: false,
      arquivado: false,
      janelaProva: { inicio: '', fim: '' },
      disciplinas: disciplinas,
      criadoEm: anterior && anterior.criadoEm ? anterior.criadoEm : D.hojeISO(),
      atualizadoEm: new Date().toISOString()
    };
    if (admin) {
      state.editais = (state.editais || []).filter(function (x) { return x.id !== id; });
      state.editais.push(registro);
    } else {
      state.config.carreirasPersonalizadas = lista.filter(function (x) { return x.id !== id; });
      state.config.carreirasPersonalizadas.push(registro);
    }
    salvar();
    if (admin) publicarCatalogoAdmin({ toast: true }).finally(render);
    fecharModal();
    render();
    toast('Carreira salva: ' + v.resumo.disciplinas + ' disciplinas, ' + v.resumo.topicos + ' tópicos', 'sucesso');
  }

  const PROMPT_EDITAL_BRUTO = [
    'Você é um especialista em concursos públicos. Vou colar o conteúdo programático de um edital.',
    'Sua tarefa: transformar esse edital bruto em um JSON estruturado para um app de estudos.',
    '',
    'Regras:',
    '- Identifique cargo, banca, órgão e área.',
    '- Liste as disciplinas e, dentro de cada uma, os tópicos do edital.',
    '- Quebre leis grandes em 2–3 tópicos de 2 a 9 horas de estudo cada.',
    '- Para cada tópico estime "incidencia_pct" (0 a 100) pelo histórico da banca; se não souber, use 0.',
    '- "prioridade": 1 (essencial), 2 (importante) ou 3 (periférico).',
    '- "peso" da disciplina: 1 a 3 conforme o peso na prova.',
    '- Sugira a nota de corte estimada (%) e a janela provável da prova (mês/ano).',
    '- Responda APENAS com o JSON, sem comentários, exatamente neste formato:',
    '',
    '{',
    '  "versao": 1,',
    '  "plano": { "concurso": "Órgão — Cargo", "banca": "FCC", "meta": { "corte_pct": 75 } },',
    '  "disciplinas": [',
    '    { "id": "POR", "nome": "Língua Portuguesa", "cor": "#3B82F6", "peso": 2, "base_teorica": "pdf",',
    '      "topicos": [',
    '        { "id": "POR-01", "nome": "Interpretação de texto", "incidencia_pct": 30, "prioridade": 1, "horas_estimadas": 4 }',
    '      ] }',
    '  ]',
    '}',
    '',
    'Agora processe este edital:',
    '<<COLE O EDITAL AQUI>>'
  ].join('\n');

  function abrirPromptEditalBruto() {
    const m = abrirModal('<h3>Organizar edital bruto com IA (grátis)</h3>' +
      '<p class="sub">Abra uma IA gratuita, cole o texto do edital com o prompt abaixo e traga o JSON de volta em "Importar JSON / planilha".</p>' +
      '<div class="modal-acoes" style="justify-content:flex-start">' +
      '<a class="botao-secundario botao-mini" href="https://claude.ai/new" target="_blank" rel="noopener">Abrir Claude.ai</a>' +
      '<a class="botao-secundario botao-mini" href="https://notebooklm.google.com" target="_blank" rel="noopener">Abrir NotebookLM</a>' +
      '<button class="botao-mini" id="pb-copiar">Copiar prompt</button></div>' +
      '<textarea id="pb-prompt" rows="14" readonly style="margin-top:0.5rem;font-family:var(--fonte-mono);font-size:0.8rem">' + esc(PROMPT_EDITAL_BRUTO) + '</textarea>' +
      '<div class="modal-acoes"><button class="botao-quieto" id="pb-fechar">Fechar</button></div>');
    m.classList.add('modal-amplo');
    m.querySelector('#pb-fechar').addEventListener('click', fecharModal);
    m.querySelector('#pb-copiar').addEventListener('click', function () {
      const ta = m.querySelector('#pb-prompt');
      ta.select();
      try { navigator.clipboard.writeText(ta.value); } catch (err) { try { document.execCommand('copy'); } catch (e2) { /* ignore */ } }
      toast('Prompt copiado');
    });
  }

  // cria uma entrada nova em state.planos a partir do JSON (status zerados) e ativa
  function adicionarPlano(json) {
    const base = D.mesclarPlano({ plano: null, disciplinas: [], sessoes: [], revisoes: [], simulados: [], config: {} }, json);
    const entrada = {
      id: window.Store.novoId('pln'),
      criadoEm: D.hojeISO(),
      plano: base.plano,
      disciplinas: base.disciplinas,
      cronogramas: base.cronogramas,
      links: base.links || []
    };
    state.planos.push(entrada);
    window.Store.ativarPlano(state, entrada.id);
    ['sessoes', 'revisoes', 'simulados', 'agenda', 'flashcards'].forEach(function (ch) {
      if (!Array.isArray(base[ch])) return;
      state[ch] = (state[ch] || []).concat(base[ch].map(function (item) {
        return Object.assign({}, item, { planoId: entrada.id });
      }));
    });
    if (base.config) state.config = Object.assign({}, state.config || {}, base.config);
    editalAbertas = new Set();
    if (state.config) delete state.config.apagadoEm; // há dados de novo: remove o marcador de exclusão
    salvar();
    return entrada;
  }

  // disciplinas manuais precisam de um plano para morar
  function garantirPlanoAtivo() {
    if (state.planoAtivoId) return;
    const entrada = {
      id: window.Store.novoId('pln'),
      criadoEm: D.hojeISO(),
      plano: { concurso: 'Meus estudos (pessoal)', banca: '', cota: null, meta: { corte_pct: 70 }, radar: null, ritmos: null, ritmoAtivo: 'sustentavel', gerado_em: null },
      disciplinas: [],
      cronogramas: { sustentavel: [], hardcore: [] },
      links: []
    };
    state.planos.push(entrada);
    window.Store.ativarPlano(state, entrada.id);
    if (state.config) delete state.config.apagadoEm;
    salvar();
  }

  function ligarCarreirasConfiguracao(raiz) {
    const nova = raiz.querySelector('#car-nova');
    if (nova) nova.addEventListener('click', function () { abrirEditorCarreira(null); });
    raiz.querySelectorAll('[data-car-editar]').forEach(function (b) {
      b.addEventListener('click', function () { abrirEditorCarreira(b.getAttribute('data-car-editar')); });
    });
    raiz.querySelectorAll('[data-car-ver]').forEach(function (b) {
      b.addEventListener('click', function () {
        catalogoFiltro = { tipo: 'carreira', busca: '', orgao: '', cargo: '', estado: '' };
        location.hash = '#planos';
      });
    });
    raiz.querySelectorAll('[data-car-remover]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = b.getAttribute('data-car-remover');
        const admin = usuarioAdmin();
        const lista = admin ? carreirasGlobais() : carreirasPersonalizadas();
        const personalizada = lista.find(function (x) { return x.id === id; });
        if (!personalizada) return;
        const temBase = !!carreiraBasePorId(id);
        const restauraPlataforma = !admin && carreirasGlobais().some(function (x) { return x.id === id; });
        confirmar({
          titulo: restauraPlataforma ? 'Restaurar versão da plataforma?' : (temBase ? 'Restaurar carreira original?' : 'Excluir carreira?'),
          mensagem: restauraPlataforma
            ? 'Sua versão de "' + personalizada.titulo + '" será removida e a carreira publicada pela plataforma voltará ao catálogo. Planos já criados continuam como estão.'
            : (temBase
            ? 'As alterações em "' + personalizada.titulo + '" serão removidas e o modelo original voltará ao catálogo' + (admin ? ' de todos os alunos' : '') + '. Planos já criados continuam como estão.'
            : 'A carreira "' + personalizada.titulo + '" sairá do catálogo' + (admin ? ' de todos os alunos' : '') + '. Planos já criados a partir dela continuam existindo.'),
          confirmar: restauraPlataforma ? 'Restaurar versão' : (temBase ? 'Restaurar original' : 'Excluir carreira'),
          perigo: !temBase && !restauraPlataforma,
          icone: (temBase || restauraPlataforma) ? '↺' : '🗑️'
        }).then(function (ok) {
          if (!ok) return;
          if (admin) {
            state.editais = (state.editais || []).filter(function (x) { return x.id !== id; });
            catalogoGlobalEditais = (catalogoGlobalEditais || []).filter(function (x) { return x.id !== id; });
          } else {
            state.config.carreirasPersonalizadas = carreirasPersonalizadas().filter(function (x) { return x.id !== id; });
          }
          comparacaoIds = comparacaoIds.filter(function (x) { return x !== id; });
          salvar();
          if (admin) publicarCatalogoAdmin({ toast: true, permitirVazio: true, removerId: id }).finally(render);
          render();
          toast(restauraPlataforma ? 'Versão da plataforma restaurada' : (temBase ? 'Modelo original restaurado' : 'Carreira excluída'));
        });
      });
    });
  }

  function ligarPlanosBaseConfiguracao(raiz) {
    raiz.querySelectorAll('[data-base-editar]').forEach(function (b) {
      b.addEventListener('click', function () { abrirEditorEdital(b.getAttribute('data-base-editar'), 'editar'); });
    });
    raiz.querySelectorAll('[data-base-ver]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = b.getAttribute('data-base-ver');
        const e = editalPorId(id);
        catalogoFiltro = { tipo: 'concurso', busca: e ? e.titulo : '', orgao: '', cargo: '', estado: '' };
        location.hash = '#planos';
      });
    });
    raiz.querySelectorAll('[data-base-restaurar]').forEach(function (b) {
      b.addEventListener('click', function () {
        const id = b.getAttribute('data-base-restaurar');
        const e = (state.editais || []).find(function (x) { return x.id === id; });
        if (!e) return;
        confirmar({
          titulo: 'Restaurar plano original?',
          mensagem: 'Sua personalização de "' + e.titulo + '" será removida. Planos de estudo já criados continuam como estão.',
          confirmar: 'Restaurar original',
          icone: '↺'
        }).then(function (ok) {
          if (!ok) return;
          state.editais = (state.editais || []).filter(function (x) { return x.id !== id; });
          salvar(); render(); toast('Plano original restaurado');
        });
      });
    });
  }

  function ligarAjustes(raiz) {
    ligarPlanosBaseConfiguracao(raiz);
    ligarCarreirasConfiguracao(raiz);
    const ritmo = raiz.querySelector('#aj-ritmo');
    if (ritmo) ritmo.addEventListener('change', function () {
      state.plano.ritmoAtivo = ritmo.value;
      salvar(); render();
      toast('Ritmo alterado para ' + (ritmo.value === 'hardcore' ? 'hardcore 120 dias' : 'sustentável'), 'sucesso');
    });
    const metaQ = raiz.querySelector('#aj-meta-q');
    if (metaQ) metaQ.addEventListener('change', function () {
      state.config.metaQuestoesSemana = Math.max(0, parseInt(metaQ.value, 10) || 0);
      salvar();
      toast('Meta de questões atualizada', 'sucesso');
    });
    const nomeUsuarioEl = raiz.querySelector('#aj-nome-usuario');
    if (nomeUsuarioEl) nomeUsuarioEl.addEventListener('change', function () {
      state.config.nomeUsuario = nomeUsuarioEl.value.trim();
      state.config.onboardingNomeVisto = true;
      salvar();
      toast('Nome atualizado', 'sucesso');
    });
    const syncAgora = raiz.querySelector('#sync-agora');
    if (syncAgora) syncAgora.addEventListener('click', function () {
      if (window.FirebaseSync && window.FirebaseSync.ativo()) {
        syncAgora.disabled = true;
        window.FirebaseSync.sincronizarAgora({ silencioso: false }).finally(function () {
          syncAgora.disabled = false;
          firebaseStatus = window.FirebaseSync.status();
          atualizarSyncUi();
        });
        return;
      }
      if (!window.Sync) { toast('Sincronização indisponível neste navegador.', 'erro'); return; }
      syncAgora.disabled = true;
      window.Sync.sincronizarAgora({ silencioso: false }).finally(function () {
        syncAgora.disabled = false;
        syncStatus = window.Sync.status();
        atualizarSyncUi();
      });
    });
    const fbLogin = raiz.querySelector('#fb-login');
    if (fbLogin) fbLogin.addEventListener('click', function () {
      if (!window.FirebaseSync) { toast('Firebase ainda está carregando. Tente de novo em alguns segundos.', 'erro'); return; }
      fbLogin.disabled = true;
      window.FirebaseSync.login().catch(function () {
        toast('Não consegui entrar com Google. Confira Auth e domínio autorizado no Firebase.', 'erro');
      }).finally(function () {
        fbLogin.disabled = false;
      });
    });
    const fbLogout = raiz.querySelector('#fb-logout');
    if (fbLogout) fbLogout.addEventListener('click', function () {
      sairDaContaComSeguranca(fbLogout);
    });

    ligarEditaisEsquematizados(raiz);

    const fbBackups = raiz.querySelector('#fb-backups');
    if (fbBackups) fbBackups.addEventListener('click', abrirBackupsNuvem);
    const backupExportar = raiz.querySelector('#backup-exportar');
    if (backupExportar) backupExportar.addEventListener('click', function () {
      if (modoDemo) return;
      const persistencia = window.Store.exportarBackup(state);
      if (window.FirebaseSync) window.FirebaseSync.agendarEnvio(state);
      toast(persistencia && persistencia.ok === false
        ? 'Backup baixado. O armazenamento local está cheio; guarde este arquivo.'
        : 'Backup baixado', persistencia && persistencia.ok === false ? 'erro' : 'sucesso');
    });
    const backupImportar = raiz.querySelector('#backup-importar');
    const backupArquivo = raiz.querySelector('#backup-arquivo');
    if (backupImportar && backupArquivo) {
      backupImportar.addEventListener('click', function () { backupArquivo.value = ''; backupArquivo.click(); });
      backupArquivo.addEventListener('change', function () {
        const arquivo = backupArquivo.files && backupArquivo.files[0];
        if (!arquivo) return;
        if (arquivo.size > 10 * 1024 * 1024) {
          toast('Esse backup é grande demais (máximo de 10 MB).', 'erro');
          return;
        }
        arquivo.text().then(function (texto) {
          const resultado = window.Store.importarBackup(texto, { persistir: false });
          if (!resultado.ok) { toast(resultado.erro, 'erro'); return; }
          confirmar({
            titulo: 'Restaurar este backup?',
            mensagem: 'Os dados atuais serão substituídos pelo conteúdo do arquivo. Uma nova cópia será sincronizada com a nuvem.',
            confirmar: 'Restaurar',
            perigo: true,
            icone: '↺'
          }).then(function (ok) {
            if (!ok) return;
            const anterior = state;
            const restaurado = resultado.state;
            const agora = new Date().toISOString();
            const idsRestaurados = {};
            ['sessoes', 'revisoes', 'simulados', 'flashcards'].forEach(function (lista) {
              (restaurado[lista] || []).forEach(function (item) { if (item && item.id) idsRestaurados[item.id] = true; });
            });
            restaurado.config.removidos = (restaurado.config.removidos || []).filter(function (id) { return !idsRestaurados[id]; });
            const removidosAgora = [];
            ['sessoes', 'revisoes', 'simulados', 'flashcards'].forEach(function (lista) {
              (anterior[lista] || []).forEach(function (item) {
                if (item && item.id && !idsRestaurados[item.id]) removidosAgora.push(item.id);
              });
            });
            window.Store.marcarRemovido(restaurado, removidosAgora);

            if (!restaurado.config.planosExcluidos || typeof restaurado.config.planosExcluidos !== 'object') restaurado.config.planosExcluidos = {};
            const planosRestaurados = {};
            (restaurado.planos || []).forEach(function (p) {
              if (!p || !p.id) return;
              planosRestaurados[p.id] = true;
              delete restaurado.config.planosExcluidos[p.id];
              p.atualizadoEm = agora;
            });
            (anterior.planos || []).forEach(function (p) {
              if (p && p.id && !planosRestaurados[p.id]) restaurado.config.planosExcluidos[p.id] = agora;
            });
            restaurado.config.rev = Math.max(
              parseInt(restaurado.config.rev, 10) || 0,
              parseInt(anterior.config && anterior.config.rev, 10) || 0
            );
            if (window.Store.temDados(restaurado)) delete restaurado.config.apagadoEm;
            state = restaurado;
            salvar();
            render();
            toast('Backup restaurado e pronto para sincronizar', 'sucesso');
          });
        }).catch(function () {
          toast('Não foi possível ler esse arquivo.', 'erro');
        });
      });
    }

    raiz.querySelectorAll('[data-rec-edital]').forEach(function (b) {
      b.addEventListener('click', function () { criarPlanoDeEdital(b.getAttribute('data-rec-edital')); });
    });
    const recOrfaos = raiz.querySelector('#rec-orfaos');
    if (recOrfaos) recOrfaos.addEventListener('click', function () {
      const n = vincularOrfaosAoPlanoAtivo();
      render();
      toast(n > 0 ? n + ' registro(s) recuperado(s) para o plano ativo' : 'Nada para recuperar', n > 0 ? 'sucesso' : 'erro');
    });

    raiz.querySelector('#zr-limpar').addEventListener('click', function () {
      confirmar({ titulo: 'Recomeçar do zero?', mensagem: 'Seus planos, sessões, revisões, simulados e agenda serão apagados para você começar de novo. O catálogo de editais e suas configurações são mantidos. Esta ação não tem volta.', confirmar: 'Apagar meus dados', perigo: true, icone: '⚠️' }).then(function (ok) {
        if (!ok) return;
        // Zera apenas os dados de estudo do aluno; preserva o catálogo de editais
        // (catálogo global, no caso do admin) e as configurações pessoais.
        const apagadoEm = new Date().toISOString();
        window.Store.marcarRemovido(state, ['sessoes', 'revisoes', 'simulados', 'flashcards'].reduce(function (ids, lista) {
          return ids.concat((state[lista] || []).map(function (item) { return item && item.id; }));
        }, []));
        if (!state.config.planosExcluidos || typeof state.config.planosExcluidos !== 'object') state.config.planosExcluidos = {};
        state.planos.forEach(function (p) { if (p && p.id) state.config.planosExcluidos[p.id] = apagadoEm; });
        state.planos = [];
        state.planoAtivoId = null;
        state.sessoes = [];
        state.revisoes = [];
        state.simulados = [];
        state.agenda = [];
        state.flashcards = [];
        window.Store.hidratar(state);
        state.config.apagadoEm = apagadoEm;
        salvar(); render();
        toast('Seus dados de estudo foram apagados');
      });
    });
  }

  // ---------------- TELA: Planejamento (agenda manual) ----------------
  let agendaModo = 'semana';                       // 'semana' | 'mes'
  let agendaRef = D.segundaDaSemana(D.hojeISO());  // segunda da semana exibida
  let mesRef = D.hojeISO().slice(0, 7);            // 'AAAA-MM' do mês exibido

  const DIAS_CURTOS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const ROTINA_DIAS = [
    { id: 'dom', label: 'DOM', offset: 6, ativo: false, minutos: 120 },
    { id: 'seg', label: 'SEG', offset: 0, ativo: true, minutos: 180 },
    { id: 'ter', label: 'TER', offset: 1, ativo: true, minutos: 120 },
    { id: 'qua', label: 'QUA', offset: 2, ativo: true, minutos: 180 },
    { id: 'qui', label: 'QUI', offset: 3, ativo: true, minutos: 120 },
    { id: 'sex', label: 'SEX', offset: 4, ativo: true, minutos: 180 },
    { id: 'sab', label: 'SÁB', offset: 5, ativo: true, minutos: 180 }
  ];

  // RN-Antifadiga (Regra 1): blocos permitidos — 30min, 45min, 1h, 1h15, 1h30, 2h
  const TEMPOS_BLOCO = [30, 45, 60, 75, 90, 120];

  function rotuloBloco(min) {
    if (min < 60) return min + 'min';
    const h = Math.floor(min / 60), m = min % 60;
    return h + 'h' + (m > 0 ? String(m).padStart(2, '0') : '');
  }

  function parseHorasDia(valor) {
    const texto = String(valor || '').trim().replace(',', '.');
    const m = /^(\d{1,2}):(\d{2})$/.exec(texto);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const horas = parseFloat(texto);
    return Number.isFinite(horas) ? Math.round(horas * 60) : 0;
  }

  function formatarHorasDia(min) {
    return String(Math.floor((min || 0) / 60)).padStart(2, '0') + ':' + String((min || 0) % 60).padStart(2, '0');
  }

  function rotinaPadrao() {
    const dias = {};
    ROTINA_DIAS.forEach(function (d) {
      dias[d.id] = { ativo: d.ativo, minutos: d.minutos };
    });
    return { dias: dias, minBloco: 45, maxBloco: 60 };
  }

  function rotinaEstudosAtual() {
    const base = rotinaPadrao();
    const atual = state.config && state.config.rotinaEstudos ? state.config.rotinaEstudos : {};
    if (atual.dias) {
      ROTINA_DIAS.forEach(function (d) {
        if (!atual.dias[d.id]) return;
        base.dias[d.id] = Object.assign({}, base.dias[d.id], atual.dias[d.id]);
      });
    }
    base.minBloco = parseInt(atual.minBloco, 10) || base.minBloco;
    base.maxBloco = parseInt(atual.maxBloco, 10) || base.maxBloco;
    return base;
  }

  function rotinaSemDiasAtivos() {
    return totalMinutosRotina(rotinaEstudosAtual()) < 1;
  }

  function totalMinutosRotina(rotina) {
    return ROTINA_DIAS.reduce(function (n, d) {
      const dia = rotina.dias[d.id];
      return n + (dia && dia.ativo ? dia.minutos || 0 : 0);
    }, 0);
  }

  function rotuloHorarioAgenda(bloco) {
    if (bloco.horaInicio && bloco.horaFim) return bloco.horaInicio + ' - ' + bloco.horaFim;
    return D.formatarMin(bloco.duracaoMin || 0);
  }

  // Fundo claro do chip mensal a partir da cor da disciplina (mistura com a
  // superfície para o texto escuro ficar legível; no modo escuro, o CSS ajusta).
  function corChipMes(cor) {
    return 'color-mix(in srgb, ' + (cor || '#9A9DA3') + ' 22%, var(--vidro))';
  }

  function blocoFeitoMin(b) { return Math.max(0, Math.round(b.feitoMin || 0)); }
  function blocoRestanteMin(b) { return Math.max(0, (b.duracaoMin || 0) - blocoFeitoMin(b)); }
  // Minutos que o bloco contribui ao TOTAL do dia: o planejado, ou o realmente
  // estudado quando este passa do planejado (estudar 2h num bloco de 1h soma 2h).
  function blocoMinContado(b) { return Math.max(b.duracaoMin || 0, blocoFeitoMin(b)); }
  // Quanto foi estudado ALÉM do planejado (0 se não excedeu).
  function blocoExcedenteMin(b) { return Math.max(0, blocoFeitoMin(b) - (b.duracaoMin || 0)); }
  // Progresso parcial: o bloco tem tempo estudado mas ainda não fechou.
  function blocoParcial(b) {
    return !blocoAgendaConcluido(b) && blocoFeitoMin(b) > 0 && (b.duracaoMin || 0) > 0;
  }
  // Credita minutos estudados a um bloco da agenda; fecha (feito) ao alcançar o
  // tempo planejado. Usado pelo timer iniciado no bloco e pelo registro manual.
  function creditarBlocoAgenda(blocoId, minutos) {
    const b = state.agenda.find(function (x) { return x.id === blocoId; });
    if (!b) return null;
    const plano = b.duracaoMin || 0;
    // Não limita ao planejado: se estudou mais que o previsto, o excedente é
    // guardado (aparece no total do dia e no rótulo do bloco). O progresso visual
    // continua limitado a 100% pela própria barra.
    b.feitoMin = Math.max(0, (b.feitoMin || 0) + Math.max(0, minutos || 0));
    if (plano > 0 && b.feitoMin >= plano - 0.5) b.feito = true; // margem p/ arredondamento
    return b;
  }

  // Tipo explícito de um bloco (teoria/questoes/revisao) a partir da anotação;
  // null quando é um bloco genérico (sem tipo marcado).
  function blocoTipo(b) {
    return (b.obs === 'questoes' || b.obs === 'revisao' || b.obs === 'teoria') ? b.obs : null;
  }
  // Acha um bloco da agenda ABERTO que combine com a sessão (mesmo tópico, ou
  // bloco de "disciplina inteira" da mesma disciplina) na data informada. Permite
  // que QUALQUER timer/registro (aba Timer, FAB, fila do Hoje) desconte do bloco
  // do dia sem precisar iniciar pelo próprio bloco. Para não fechar um bloco do
  // tipo errado (ex.: questões abatendo um bloco de TEORIA), só casa blocos
  // genéricos ou do MESMO tipo da sessão. Empate: tipo igual → tópico exato →
  // mais tempo restante.
  function acharBlocoParaSessao(topicoId, dataISO, tipo) {
    if (!topicoId) return null;
    const disc = D.disciplinaDoTopico(state, topicoId);
    const candidatos = doAtivo(state.agenda).filter(function (b) {
      if (b.data !== dataISO || blocoAgendaConcluido(b)) return false;
      // Aceita bloco do mesmo tópico OU da mesma disciplina (mesmo com outro
      // tópico): assim, se o aluno troca o tópico no meio do estudo, o registro
      // ainda credita o bloco planejado daquela disciplina no dia (em vez de
      // criar um bloco solto). A ordenação abaixo prioriza o tópico exato.
      const mesmaDisc = disc && b.disciplinaId === disc.id;
      const mesmoTopico = b.topicoId === topicoId || (!b.topicoId && mesmaDisc);
      if (!mesmoTopico && !mesmaDisc) return false;
      const bt = blocoTipo(b);
      return bt === null || !tipo || bt === tipo; // genérico, ou tipo igual ao da sessão
    });
    if (!candidatos.length) return null;
    candidatos.sort(function (a, b) {
      const at = blocoTipo(a) === tipo ? 0 : 1, bt = blocoTipo(b) === tipo ? 0 : 1;
      const ax = a.topicoId === topicoId ? 0 : 1, bx = b.topicoId === topicoId ? 0 : 1;
      return at - bt || ax - bx || blocoRestanteMin(b) - blocoRestanteMin(a);
    });
    return candidatos[0];
  }

  function blocoAgendaConcluido(bloco) {
    // O calendário é um REGISTRO do que foi de fato estudado a cada dia: um bloco
    // só conta como concluído (riscado) quando foi marcado feito (registro/fila do
    // Hoje ou calendário) OU quando o tempo estudado NELE alcança sua duração.
    //
    // NÃO se risca por status GLOBAL do tópico (teoria concluída/dominado): isso
    // riscava blocos que não foram estudados naquele dia/sessão — ex.: uma
    // disciplina com todos os tópicos concluídos aparecia com todos os blocos
    // riscados, mesmo os não estudados. O status do tópico vive na bolha do Edital,
    // não no calendário. Também não usamos "existe sessão do tópico no dia" (com o
    // tópico dividido em 2 blocos no mesmo dia, uma sessão riscaria os dois).
    if (bloco.feito) return true;
    const planoMin = bloco.duracaoMin || 0;
    return planoMin > 0 && blocoFeitoMin(bloco) >= planoMin - 0.5;
  }

  // A semana (a partir de inicioISO) já tem progresso do aluno? True se algum bloco
  // gerado dela está concluído ou parcial — sinal de que regenerá-la apagaria
  // trabalho já feito. Usado para o recálculo não destruir o dia em curso.
  function semanaAgendaComProgresso(inicioISO) {
    const fim = D.addDias(inicioISO, 7);
    return doAtivo(state.agenda).some(function (a) {
      return a.gerado && a.data >= inicioISO && a.data < fim &&
        (a.feito || (a.feitoMin || 0) > 0 || blocoAgendaConcluido(a));
    });
  }

  // Minutos de estudo REGISTRADOS (sessões) num dia — fonte que não depende dos
  // blocos do calendário (cobre estudo por timer sem bloco, ou blocos apagados/
  // regenerados). Usado para saber se o dia já foi "cumprido".
  function minutosEstudadosNoDia(diaISO) {
    return D.sessoesDoPlano(state)
      .filter(function (s) { return s.data === diaISO; })
      .reduce(function (n, s) { return n + (s.duracaoMin || 0); }, 0);
  }
  // O dia já teve QUALQUER estudo (sessão registrada ou bloco com progresso)?
  // Um dia assim não pode ser regenerado sem apagar trabalho já feito.
  function diaTeveEstudo(diaISO) {
    if (minutosEstudadosNoDia(diaISO) > 0) return true;
    return doAtivo(state.agenda).some(function (a) {
      return a.data === diaISO && (a.feito || (a.feitoMin || 0) > 0 || blocoAgendaConcluido(a));
    });
  }

  // Ordem dos blocos dentro de um dia (permite reordenar manualmente)
  function ordemAgenda(b) { return typeof b.ordem === 'number' ? b.ordem : 1e9; }
  function compararAgenda(a, b) {
    return ordemAgenda(a) - ordemAgenda(b) ||
      (a.horaInicio || '').localeCompare(b.horaInicio || '') || a.id.localeCompare(b.id);
  }
  function blocosDoDia(diaISO) {
    return doAtivo(state.agenda).filter(function (a) { return a.data === diaISO; }).sort(compararAgenda);
  }
  // Revisões (repetição espaçada) pendentes de um dia — fonte única, refletida no
  // calendário; cada uma já descontou tempo do dia na geração da agenda.
  function revisoesDoDia(diaISO) { return D.revisoesPendentesNoDia(state, diaISO); }
  // Revisões CONCLUÍDAS num dia (pela data em que foram feitas) — ficam no
  // calendário riscadas, como registro de que o aluno cumpriu a revisão. Não
  // entram na carga horária planejada do dia (já foram feitas).
  function revisoesConcluidasNoDia(diaISO) {
    return doAtivo(state.revisoes).filter(function (r) {
      return r && r.dataConcluida === diaISO && D.topicoPorId(state, r.topicoId);
    });
  }
  // Simulados registrados num dia (do plano ativo) — marcados no calendário.
  function simuladosDoDia(diaISO) {
    return doAtivo(state.simulados).filter(function (s) { return s.data === diaISO; });
  }
  // Resumo curto de um simulado: nº de questões e % geral de acerto.
  function resumoSimulado(s) {
    let c = 0, q = 0;
    (s.acertos || []).forEach(function (a) { c += a.certas || 0; q += a.total || 0; });
    const pct = q > 0 ? Math.round((c / q) * 100) : null;
    return { certas: c, total: q, pct: pct };
  }
  function rotuloTipoRevisao(tipo) { return tipo === 'reforço' || tipo === 'manutenção' ? tipo : tipo; }
  // Chip de revisão para a grade semanal (não arrastável; clica para mover).
  function revisaoChipSemana(r) {
    const t = D.topicoPorId(state, r.topicoId);
    const d = D.disciplinaDoTopico(state, r.topicoId);
    const cor = d ? d.cor : '#9A9DA3';
    const dur = D.duracaoRevisaoMin(r.tipo);
    const sub = D.formatarMin(dur) + ' · ' + rotuloTipoRevisao(r.tipo) + (t ? ' · ' + t.nome : '');
    return '<div class="agenda-bloco agenda-bloco-revisao" data-revisao="' + esc(r.id) + '" role="button" tabindex="0" style="border-color:' + esc(cor) + '" title="Revisão · ' + esc(sub) + ' · toque para concluir ou mover">' +
      '<span class="agenda-bloco-rev-ic" aria-hidden="true">🔁</span>' +
      '<span class="agenda-bloco-texto"><span class="agenda-bloco-titulo">Revisão</span>' +
      '<span class="agenda-bloco-sub">' + esc(sub) + '</span></span></div>';
  }
  // Chip de revisão JÁ CONCLUÍDA — riscado (visual "feito"), como registro no
  // calendário de que a revisão foi cumprida naquele dia. Clica para rever.
  function revisaoChipConcluida(r) {
    const t = D.topicoPorId(state, r.topicoId);
    const d = D.disciplinaDoTopico(state, r.topicoId);
    const cor = d ? d.cor : '#9A9DA3';
    const pctTxt = r.resultadoPct != null ? ' · ' + r.resultadoPct + '%' : '';
    const sub = D.formatarMin(D.duracaoRevisaoConcluidaMin(state, r)) + ' · revisão ' + rotuloTipoRevisao(r.tipo) + (t ? ' · ' + t.nome : '') + pctTxt;
    return '<div class="agenda-bloco agenda-bloco-revisao feito" data-revisao-feita="' + esc(r.id) + '" role="button" tabindex="0" style="border-color:' + esc(cor) + '" title="Revisão concluída · ' + esc(sub) + '">' +
      '<span class="agenda-bloco-rev-ic" aria-hidden="true">✓</span>' +
      '<span class="agenda-bloco-texto"><span class="agenda-bloco-titulo">Revisão feita</span>' +
      '<span class="agenda-bloco-sub">' + esc(sub) + '</span></span></div>';
  }

  // Menu de ações da revisão ao tocar no card do calendário: Concluir (se vencida
  // ou de hoje) e Mover de dia. Substitui o antigo botão ✓ inline (que deformava
  // no card estreito) por um diálogo claro.
  function abrirAcoesRevisao(revId) {
    const r = doAtivo(state.revisoes).find(function (x) { return x.id === revId; });
    if (!r) return;
    const t = D.topicoPorId(state, r.topicoId);
    const podeConcluir = r.dataAgendada <= D.hojeISO();
    const m = abrirModal(
      '<h3>Revisão ' + esc(rotuloTipoRevisao(r.tipo)) + '</h3>' +
      '<p class="sub">' + (t ? esc(t.nome) + ' · ' : '') + D.formatarMin(D.duracaoRevisaoMin(r.tipo)) +
      ' · agendada para ' + D.formatarDataBR(r.dataAgendada) + '</p>' +
      '<div class="modal-acoes modal-acoes-coluna">' +
      (podeConcluir ? '<button type="button" id="rev-ac-concluir">✓ Concluir revisão</button>' : '') +
      (podeConcluir ? '<button type="button" class="botao-secundario" id="rev-ac-timer">▶ Cronometrar</button>' : '') +
      '<button type="button" class="botao-secundario" id="rev-ac-mover">Mover de dia</button>' +
      '<button type="button" class="botao-quieto" id="rev-ac-cancelar">Cancelar</button>' +
      '</div>'
    );
    m.querySelector('#rev-ac-cancelar').addEventListener('click', fecharModal);
    const bc = m.querySelector('#rev-ac-concluir');
    if (bc) bc.addEventListener('click', function () { fecharModal(); abrirConcluirRevisao(revId); });
    const bt = m.querySelector('#rev-ac-timer');
    if (bt) bt.addEventListener('click', function () { fecharModal(); iniciarTimerDaRevisao(r); });
    m.querySelector('#rev-ac-mover').addEventListener('click', function () { fecharModal(); abrirMoverRevisao(revId); });
  }
  // Visão de uma revisão já concluída (chip riscado do calendário): só leitura.
  function abrirDetalhesRevisaoConcluida(revId) {
    const r = doAtivo(state.revisoes).find(function (x) { return x.id === revId; });
    if (!r) return;
    const t = D.topicoPorId(state, r.topicoId);
    const m = abrirModal(
      '<h3>Revisão concluída ✓</h3>' +
      '<p class="sub">' + (t ? esc(t.nome) + ' · ' : '') + 'revisão ' + esc(rotuloTipoRevisao(r.tipo)) +
      ' · ' + D.formatarMin(D.duracaoRevisaoConcluidaMin(state, r)) + '</p>' +
      '<p class="sub">Concluída em ' + D.formatarDataBR(r.dataConcluida) +
      (r.resultadoPct != null ? ' · desempenho ' + r.resultadoPct + '%' : '') + '</p>' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="revf-fechar">Fechar</button></div>'
    );
    m.querySelector('#revf-fechar').addEventListener('click', fecharModal);
  }
  // Chip de simulado para a grade semanal (clica para abrir os detalhes do dia).
  function simuladoChipSemana(s) {
    const r = resumoSimulado(s);
    const tipoTxt = s.tipo === 'total' ? 'Simulado total' : s.tipo === 'parcial' ? 'Simulado parcial' : 'Simulado';
    const sub = (r.total > 0 ? r.certas + '/' + r.total + ' acertos' + (r.pct != null ? ' · ' + r.pct + '%' : '') : 'registrado') +
      (s.duracaoMin ? ' · ' + D.formatarMin(s.duracaoMin) : '');
    // Simulado é sempre um evento já concluído (registrado após ser feito), por
    // isso entra com o visual de "feito" (esmaecido + riscado), como os blocos
    // concluídos da agenda.
    return '<div class="agenda-bloco agenda-bloco-simulado feito" data-dia-detalhe="' + esc(s.data) + '" role="button" tabindex="0" title="' + esc(tipoTxt + ' · ' + sub + ' · já realizado') + '">' +
      '<span class="agenda-bloco-rev-ic" aria-hidden="true">📝</span>' +
      '<span class="agenda-bloco-texto"><span class="agenda-bloco-titulo">Simulado ✓</span>' +
      '<span class="agenda-bloco-sub">' + esc(sub) + '</span></span></div>';
  }
  // Move uma revisão de dia (ajuste manual sobre o agendamento do motor). Re-reserva
  // o tempo das semanas afetadas (gerarBlocosSemanaAgenda preserva blocos manuais).
  function abrirMoverRevisao(revId) {
    const r = doAtivo(state.revisoes).find(function (x) { return x.id === revId; });
    if (!r) return;
    const t = D.topicoPorId(state, r.topicoId);
    const m = abrirModal(
      '<h3>Mover revisão</h3>' +
      '<p class="sub">' + (t ? esc(t.nome) + ' · ' : '') + 'revisão ' + esc(rotuloTipoRevisao(r.tipo)) + ' · ' + D.formatarMin(D.duracaoRevisaoMin(r.tipo)) + '</p>' +
      '<label for="mv-data">Nova data</label>' +
      '<input id="mv-data" type="date" value="' + esc(r.dataAgendada) + '" min="' + esc(D.hojeISO()) + '">' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="mv-cancelar">Cancelar</button>' +
      '<button type="button" id="mv-salvar">Mover</button></div>'
    );
    m.querySelector('#mv-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#mv-salvar').addEventListener('click', function () {
      const nova = m.querySelector('#mv-data').value;
      if (!nova) { toast('Escolha uma data.', 'erro'); return; }
      const antiga = r.dataAgendada;
      r.dataAgendada = nova;
      const semanaAtual = D.segundaDaSemana(D.hojeISO());
      const semanasFeitas = {};
      [antiga, nova].forEach(function (dt) {
        const ini = D.segundaDaSemana(dt);
        if (ini < semanaAtual || semanasFeitas[ini]) return;
        semanasFeitas[ini] = true;
        // Ao re-reservar o tempo da SEMANA ATUAL, preserva HOJE e o passado da
        // semana (o que já foi estudado) e regenera só os dias seguintes — sem
        // isso, mover uma revisão apagava os blocos concluídos do dia (perda de
        // horas de estudo já registradas no calendário).
        const opts = {};
        if (ini === semanaAtual && semanaAgendaComProgresso(ini)) opts.preservarDia = D.hojeISO();
        try { gerarBlocosSemanaAgenda(ini, opts); } catch (e) {}
      });
      salvar(); fecharModal(); render();
      toast('Revisão movida para ' + D.formatarDataBR(nova), 'sucesso');
    });
  }
  // grava a ordem explícita (0,1,2,…) de todos os blocos do dia
  function renumerarDia(diaISO) {
    blocosDoDia(diaISO).forEach(function (b, i) { b.ordem = i; });
  }
  // move/cria um bloco inserindo-o ANTES de alvoId (ou no fim, se alvoId vazio)
  function reordenarBlocoNoDia(payload, diaISO, alvoId) {
    if (!payload || !diaISO) return false;
    let bloco, diaOrigem = null;
    if (payload.indexOf('mover|') === 0) {
      bloco = state.agenda.find(function (x) { return x.id === payload.slice(6); });
      if (!bloco) return false;
      diaOrigem = bloco.data;
      bloco.data = diaISO;
    } else if (payload.indexOf('nova|') === 0) {
      bloco = {
        id: window.Store.novoId('agd'), planoId: state.planoAtivoId, data: diaISO,
        disciplinaId: payload.slice(5), topicoId: null, duracaoMin: 60, obs: '', feito: false
      };
      state.agenda.push(bloco);
    } else { return false; }
    // recompõe a ordem do dia inserindo o bloco na posição do alvo
    const ordenados = blocosDoDia(diaISO).filter(function (b) { return b.id !== bloco.id; });
    let pos = ordenados.length;
    if (alvoId) { const i = ordenados.findIndex(function (b) { return b.id === alvoId; }); if (i >= 0) pos = i; }
    ordenados.splice(pos, 0, bloco);
    ordenados.forEach(function (b, i) { b.ordem = i; });
    if (diaOrigem && diaOrigem !== diaISO) renumerarDia(diaOrigem); // fecha o buraco no dia de origem
    return true;
  }

  // Abre o timer já apontando para o bloco: o tempo cronometrado será creditado
  // nele (acumula até fechar) e o limite vem pré-preenchido com o que falta.
  function iniciarTimerDoBloco(blocoAg, topId) {
    timerPreselecao = topId;
    timerBlocoPendente = blocoAg.id;
    const restante = blocoRestanteMin(blocoAg);
    timerLimitePendente = restante > 0 ? restante : (blocoAg.duracaoMin || null);
    timerAutoIniciar = true;
    location.hash = '#timer';
  }

  // Abre o timer já apontando para uma revisão: o tópico vem pré-selecionado, o
  // limite pré-preenchido com a duração da revisão e, ao encerrar, cai direto no
  // modal de concluir a revisão (com o tempo cronometrado já preenchido).
  function iniciarTimerDaRevisao(rev) {
    if (!rev) return;
    if (!D.topicoPorId(state, rev.topicoId)) { toast('Tópico da revisão não encontrado.', 'erro'); return; }
    timerPreselecao = rev.topicoId;
    timerRevisaoPendente = rev.id;
    timerBlocoPendente = null;
    timerLimitePendente = D.duracaoRevisaoMin(rev.tipo);
    timerAutoIniciar = true;
    location.hash = '#timer';
  }

  function registrarDeAgenda(blocoAg) {
    const disc = D.disciplinaPorId(state, blocoAg.disciplinaId);
    const topId = blocoAg.topicoId || (disc && disc.topicos.length > 0 ? disc.topicos[0].id : null);
    if (!topId) { toast('Esta disciplina não tem tópicos — edite o bloco.', 'erro'); return; }
    // Pré-preenche com o tempo que ainda FALTA no bloco (progresso parcial); o
    // crédito e o fechamento do bloco ficam por conta do concluirRegistro (blocoId).
    const restante = blocoRestanteMin(blocoAg) || (blocoAg.duracaoMin || 30);
    abrirRegistro({
      topicoId: topId,
      duracaoMin: restante,
      tipo: blocoAg.obs === 'questoes' ? 'questoes' : blocoAg.obs === 'revisao' ? 'revisao' : 'teoria',
      data: blocoAg.data,
      blocoId: blocoAg.id,
      aoSalvar: function () { salvar(); render(); }
    });
  }

  // Opções de um <select> de tópicos: "disciplina inteira" + tópicos + a opção de
  // criar um tópico novo na hora. Reutilizado nos modais de agenda e ciclo.
  const OPT_NOVO_TOPICO = '__novo_topico__';
  function opcoesTopicosSelect(disc, selecionadoId) {
    return '<option value="">— disciplina inteira —</option>' +
      (disc ? disc.topicos.filter(function (t) { return !t.orfao; }).map(function (t) {
        return '<option value="' + esc(t.id) + '"' + (selecionadoId && t.id === selecionadoId ? ' selected' : '') + '>' +
          esc(t.id + ' — ' + t.nome) + (t.adicionadoPeloUsuario ? ' (novo)' : '') + '</option>';
      }).join('') : '') +
      '<option value="' + OPT_NOVO_TOPICO + '">＋ criar novo tópico…</option>';
  }

  function cabecalhoTopicoEditavel(labelFor, label, botaoId) {
    return '<div class="topico-campo-cab">' +
      '<label for="' + esc(labelFor) + '">' + esc(label) + '</label>' +
      '<button type="button" class="botao-mini botao-quieto editar-topico-btn" id="' + esc(botaoId) + '" disabled>Editar tópico</button>' +
      '</div>';
  }

  // Liga a opção "criar novo tópico" a um par (selDisc, selTop): ao escolhê-la,
  // pede o nome, cria o tópico na disciplina e já o seleciona. Preserva a escolha
  // anterior se o usuário cancelar.
  function ligarCriarTopicoSelect(selDisc, selTop, aoAtualizar) {
    selTop.dataset.prevTop = selTop.value;
    selTop.addEventListener('change', function () {
      if (selTop.value !== OPT_NOVO_TOPICO) {
        selTop.dataset.prevTop = selTop.value;
        if (aoAtualizar) aoAtualizar();
        return;
      }
      const disc = D.disciplinaPorId(state, selDisc.value);
      const prev = selTop.dataset.prevTop || '';
      if (!disc) {
        selTop.value = prev;
        if (aoAtualizar) aoAtualizar();
        return;
      }
      pedirTexto({
        titulo: 'Novo tópico', mensagem: 'Novo tópico em ' + disc.nome,
        placeholder: 'Ex.: Atos administrativos', confirmar: 'Criar', maxlength: 120
      }).then(function (nome) {
        if (!nome) {
          selTop.value = prev;
          if (aoAtualizar) aoAtualizar();
          return;
        }
        const id = adicionarTopicoUsuario(disc.id, nome);
        selTop.innerHTML = opcoesTopicosSelect(D.disciplinaPorId(state, selDisc.value), id);
        selTop.value = id || prev;
        selTop.dataset.prevTop = selTop.value;
        if (aoAtualizar) aoAtualizar();
        if (id) toast('Tópico “' + nome + '” criado.', 'sucesso');
      });
    });
  }

  // Botão contextual dos seletores de agenda/ciclo. Só fica disponível quando
  // há um tópico real selecionado (não para "disciplina inteira" ou "criar novo").
  function ligarEditarTopicoSelect(selDisc, selTop, botao) {
    function atualizar() {
      const id = selTop.value;
      const disc = D.disciplinaPorId(state, selDisc.value);
      botao.disabled = !disc || !id || id === OPT_NOVO_TOPICO ||
        !(disc.topicos || []).some(function (t) { return t.id === id && !t.orfao; });
    }
    botao.addEventListener('click', function () {
      const id = selTop.value;
      if (!id || id === OPT_NOVO_TOPICO) return;
      abrirEditarNomeTopico(selDisc.value, id, function (topico) {
        const disc = D.disciplinaPorId(state, selDisc.value);
        selTop.innerHTML = opcoesTopicosSelect(disc, topico.id);
        selTop.value = topico.id;
        selTop.dataset.prevTop = topico.id;
        atualizar();
      });
    });
    selTop.addEventListener('change', atualizar);
    selDisc.addEventListener('change', atualizar);
    atualizar();
    return atualizar;
  }

  function abrirNovoBlocoAgenda(dataISO, discIni) {
    if (state.disciplinas.length === 0) { abrirNovaDisciplina(); return; }
    const optsDisc = state.disciplinas.filter(D.disciplinaAtivaPlanejamento).map(function (d) {
      return '<option value="' + esc(d.id) + '"' + (d.id === discIni ? ' selected' : '') + '>' + esc(d.id + ' — ' + d.nome) + '</option>';
    }).join('');
    const m = abrirModal(
      '<h3>Novo bloco de estudo</h3>' +
      '<form id="form-agd">' +
      '<div class="grade-2">' +
      '<div><label for="agd-data">Dia</label><input id="agd-data" type="date" value="' + esc(dataISO) + '" required></div>' +
      '<div><label for="agd-dur">Duração (min)</label><input id="agd-dur" type="number" min="5" max="600" value="60"></div></div>' +
      '<label for="agd-disc">Disciplina</label><select id="agd-disc">' + optsDisc + '</select>' +
      cabecalhoTopicoEditavel('agd-topico', 'Tópico (opcional)', 'agd-editar-topico') +
      '<select id="agd-topico"></select>' +
      '<label for="agd-obs">Anotação (opcional)</label><input id="agd-obs" type="text" placeholder="Ex.: cap. 3 do PDF">' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="agd-cancelar">Cancelar</button>' +
      '<button type="submit">Adicionar à agenda</button></div></form>'
    );
    const selDisc = m.querySelector('#agd-disc');
    const selTop = m.querySelector('#agd-topico');
    function preencher() {
      const d = D.disciplinaPorId(state, selDisc.value);
      selTop.innerHTML = opcoesTopicosSelect(d, null);
      selTop.dataset.prevTop = selTop.value;
    }
    preencher();
    selDisc.addEventListener('change', preencher);
    const atualizarEditar = ligarEditarTopicoSelect(selDisc, selTop, m.querySelector('#agd-editar-topico'));
    ligarCriarTopicoSelect(selDisc, selTop, atualizarEditar);
    m.querySelector('#agd-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#form-agd').addEventListener('submit', function (e) {
      e.preventDefault();
      state.agenda.push({
        id: window.Store.novoId('agd'), planoId: state.planoAtivoId,
        data: m.querySelector('#agd-data').value,
        disciplinaId: selDisc.value,
        topicoId: selTop.value || null,
        duracaoMin: Math.max(5, parseInt(m.querySelector('#agd-dur').value, 10) || 60),
        obs: m.querySelector('#agd-obs').value.trim(),
        feito: false
      });
      salvar(); fecharModal(); render();
      toast('Bloco adicionado à agenda', 'sucesso');
    });
  }

  function abrirBlocoAgenda(id) {
    const a = state.agenda.find(function (x) { return x.id === id; });
    if (!a) return;
    if (blocoAgendaConcluido(a)) {
      const dFeito = D.disciplinaPorId(state, a.disciplinaId);
      const tFeito = a.topicoId ? D.topicoPorId(state, a.topicoId) : null;
      const mFeito = abrirModal(
        '<h3>Bloco concluído ✓</h3>' +
        '<p><strong>' + esc(dFeito ? dFeito.nome : a.disciplinaId) + '</strong></p>' +
        '<p class="sub">' + D.formatarDataBR(a.data) + ' · ' + D.formatarMin(blocoFeitoMin(a) || a.duracaoMin || 0) +
        (tFeito ? ' · ' + esc(tFeito.nome) : '') + '</p>' +
        '<p class="ajuste-aviso">Este bloco faz parte do seu histórico e não pode ser alterado.</p>' +
        '<div class="modal-acoes"><button type="button" class="botao-quieto" id="agde-fechar">Fechar</button></div>'
      );
      mFeito.querySelector('#agde-fechar').addEventListener('click', fecharModal);
      return;
    }
    const optsDisc = state.disciplinas.filter(function (d) {
      return d.id === a.disciplinaId || D.disciplinaAtivaPlanejamento(d);
    }).map(function (d) {
      return '<option value="' + esc(d.id) + '"' + (d.id === a.disciplinaId ? ' selected' : '') + '>' + esc(d.id + ' — ' + d.nome) + '</option>';
    }).join('');
    const m = abrirModal(
      '<h3>Bloco da agenda</h3>' +
      '<form id="form-agd-ed">' +
      '<div class="grade-2">' +
      '<div><label for="agde-data">Dia</label><input id="agde-data" type="date" value="' + esc(a.data) + '" required></div>' +
      '<div><label for="agde-dur">Duração (min)</label><input id="agde-dur" type="number" min="5" max="600" value="' + (a.duracaoMin || 60) + '"></div></div>' +
      '<label for="agde-disc">Disciplina</label><select id="agde-disc">' + optsDisc + '</select>' +
      cabecalhoTopicoEditavel('agde-topico', 'Tópico (opcional)', 'agde-editar-topico') +
      '<select id="agde-topico"></select>' +
      '<label for="agde-obs">Anotação</label><input id="agde-obs" type="text" value="' + esc(a.obs || '') + '">' +
      (blocoParcial(a)
        ? '<p class="sub agde-progresso">⏱️ Já estudado: <strong>' + D.formatarMin(blocoFeitoMin(a)) + '</strong> · faltam <strong>' + D.formatarMin(blocoRestanteMin(a)) + '</strong> de ' + D.formatarMin(a.duracaoMin || 0) + '.</p>'
        : '') +
      '<div class="modal-acoes" style="justify-content:space-between">' +
      '<button type="button" class="botao-perigo botao-mini" id="agde-excluir">Excluir</button>' +
      '<span style="display:flex;gap:0.6rem;flex-wrap:wrap">' +
      (a.feito ? '' : '<button type="button" class="botao-quieto" id="agde-timer">▶ Cronometrar</button>' +
        '<button type="button" class="botao-secundario" id="agde-registrar">Registrar sessão</button>') +
      '<button type="submit">Salvar</button></span></div></form>'
    );
    const selDisc = m.querySelector('#agde-disc');
    const selTop = m.querySelector('#agde-topico');
    function preencher() {
      const d = D.disciplinaPorId(state, selDisc.value);
      selTop.innerHTML = opcoesTopicosSelect(d, a.topicoId);
      selTop.dataset.prevTop = selTop.value;
    }
    preencher();
    selDisc.addEventListener('change', preencher);
    const atualizarEditar = ligarEditarTopicoSelect(selDisc, selTop, m.querySelector('#agde-editar-topico'));
    ligarCriarTopicoSelect(selDisc, selTop, atualizarEditar);
    m.querySelector('#agde-excluir').addEventListener('click', function () {
      state.agenda = state.agenda.filter(function (x) { return x.id !== id; });
      salvar(); fecharModal(); render();
      toast('Bloco removido');
    });
    const btnReg = m.querySelector('#agde-registrar');
    if (btnReg) btnReg.addEventListener('click', function () { fecharModal(); registrarDeAgenda(a); });
    const btnTimer = m.querySelector('#agde-timer');
    if (btnTimer) btnTimer.addEventListener('click', function () {
      const topId = a.topicoId || (D.disciplinaPorId(state, a.disciplinaId) || { topicos: [] }).topicos.map(function (t) { return t.id; })[0];
      if (!topId) { toast('Crie um tópico para esta disciplina antes de usar o timer.', 'erro'); return; }
      fecharModal();
      iniciarTimerDoBloco(a, topId);
      render();
    });
    const discOriginal = a.disciplinaId;
    m.querySelector('#form-agd-ed').addEventListener('submit', function (e) {
      e.preventDefault();
      const novaData = m.querySelector('#agde-data').value;
      const novaDur = Math.max(5, parseInt(m.querySelector('#agde-dur').value, 10) || 60);
      const novaObs = m.querySelector('#agde-obs').value.trim();
      const novaDisc = selDisc.value;
      const novoTop = selTop.value || null;
      function aplicarCampos() {
        a.data = novaData; a.duracaoMin = novaDur; a.obs = novaObs;
        a.disciplinaId = novaDisc; a.topicoId = novoTop;
      }
      // Trocou a disciplina de um bloco RECORRENTE (gerado pelo motor): pergunta se
      // vale só para esta semana ou para as próximas (regra que sobrevive à
      // regeneração). Mover/duração/anotação continuam sendo só deste bloco.
      if (novaDisc !== discOriginal && a.gerado && !a.feito) {
        abrirAlcanceRecorrente({ diaNome: nomeDiaSemana(a.data) }, function (alc) {
          if (alc === 'semana') {
            aplicarCampos();
            salvar(); fecharModal(); render();
            toast('Bloco atualizado só nesta semana', 'sucesso');
          } else {
            criarRegraTrocaRecorrente(a, discOriginal, novaDisc, alc);
          }
        });
        return;
      }
      aplicarCampos();
      salvar(); fecharModal(); render();
      toast('Bloco atualizado', 'sucesso');
    });
  }

  const DIAS_LONGOS = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'];
  function nomeDiaSemana(dataISO) { return DIAS_LONGOS[D.diaSemanaISO(dataISO)] || 'esse dia'; }
  function nomeDiaSemanaIdx(i) { return DIAS_LONGOS[i] || 'esse dia'; }

  function regrasAtivasPlano() {
    return ((state.config && state.config.regrasAgenda) || []).filter(function (r) {
      return !r.planoId || r.planoId === state.planoAtivoId;
    });
  }

  // Card das trocas recorrentes ativas, com opção de desfazer cada uma. Só aparece
  // quando há regras — mantém a tela limpa para quem não usou o recurso.
  function regrasRecorrentesHtml() {
    const regras = regrasAtivasPlano();
    if (regras.length === 0) return '';
    const linhas = regras.map(function (r) {
      const de = D.disciplinaPorId(state, r.de);
      const escopo = r.desde ? 'a partir de ' + D.formatarDataBR(r.desde) : 'todas as semanas';
      let corpo;
      if (r.paraDia != null) {
        corpo = esc(de ? de.nome : r.de) + ': <strong>' + esc(nomeDiaSemanaIdx(r.diaSemana)) + ' → ' + esc(nomeDiaSemanaIdx(r.paraDia)) + '</strong>';
      } else {
        const para = D.disciplinaPorId(state, r.para);
        corpo = 'Toda <strong>' + esc(nomeDiaSemanaIdx(r.diaSemana)) + '</strong>: ' + esc(de ? de.nome : r.de) + ' → <strong>' + esc(para ? para.nome : r.para) + '</strong>';
      }
      return '<div class="regra-rec"><span class="regra-rec-txt">' + corpo + ' <span class="sub">(' + escopo + ')</span></span>' +
        '<button class="botao-mini botao-quieto" data-regra-remover="' + esc(r.id) + '" aria-label="Desfazer">Desfazer</button></div>';
    }).join('');
    return '<div class="card regras-rec-card"><h3 style="margin:0 0 0.4rem">🔁 Estudos recorrentes ajustados</h3>' +
      '<p class="sub" style="margin:0 0 0.5rem">Trocas que valem para os próximos dias iguais. Desfazer volta ao plano original.</p>' +
      linhas + '</div>';
  }

  function removerRegraRecorrente(id) {
    if (!state.config || !Array.isArray(state.config.regrasAgenda)) return;
    state.config.regrasAgenda = state.config.regrasAgenda.filter(function (r) { return r.id !== id; });
    regenerarAgendaFuturas();
    salvar(); render();
    toast('Troca desfeita — plano original restaurado', 'sucesso');
  }

  // Modal "Editar estudo recorrente": pergunta o alcance da troca (esta semana /
  // esta e as próximas / todas). onEscolha recebe 'semana' | 'futuras' | 'todos'.
  function abrirAlcanceRecorrente(info, onEscolha) {
    const op = function (val, titulo, sub, marcado) {
      return '<label class="enf-op"><input type="radio" name="rec-alc" value="' + val + '"' + (marcado ? ' checked' : '') + '>' +
        '<span class="enf-op-txt"><strong>' + titulo + '</strong><span class="sub">' + sub + '</span></span></label>';
    };
    const m = abrirModal(
      '<h3>Editar estudo recorrente</h3>' +
      '<p class="sub">Este estudo se repete toda <strong>' + esc(info.diaNome) + '</strong>. O que você quer alterar?</p>' +
      '<div class="enf-opcoes">' +
      op('semana', 'Apenas este estudo', 'Só o bloco desta ' + esc(info.diaNome) + ' desta semana.', true) +
      op('futuras', 'Este e os próximos', 'Desta ' + esc(info.diaNome) + ' em diante.') +
      op('todos', 'Todos os estudos', 'Todas as ' + esc(info.diaNome) + 's do plano (inclui as já passadas na visão).') +
      '</div>' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="rec-cancelar">Cancelar</button>' +
      '<button type="button" id="rec-ok">Aplicar</button></div>'
    );
    m.querySelector('#rec-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#rec-ok').addEventListener('click', function () {
      const sel = m.querySelector('input[name="rec-alc"]:checked');
      onEscolha(sel ? sel.value : 'semana');
    });
  }

  // Regenera a agenda da semana atual em diante (preserva o passado). As regras de
  // estudo recorrente são reaplicadas dentro de gerarBlocosSemanaAgenda.
  function regenerarAgendaFuturas() {
    const cron = D.cronogramaAtivo(state);
    if (!cron || cron.length === 0) return 0;
    const inicioAtual = D.segundaDaSemana(D.hojeISO());
    // Semana atual com progresso: preserva hoje (e o passado) e recalcula só os
    // dias seguintes — não apaga o que já foi estudado nem pula a semana inteira.
    const hoje = D.hojeISO();
    const preservarAtual = semanaAgendaComProgresso(inicioAtual);
    let n = 0;
    cron.forEach(function (sem) {
      if (sem.inicio < inicioAtual) return;
      const opts = (sem.inicio === inicioAtual && preservarAtual) ? { preservarDia: hoje } : undefined;
      if (gerarBlocosSemanaAgenda(sem.inicio, opts)) n++;
    });
    return n;
  }

  // Aviso de cobertura: a disciplina trocada ainda tem tópicos pendentes mas ficou
  // sem nenhum bloco futuro? Então o aluno precisa saber (rebalanceamento não deu
  // conta sozinho) para não deixar conteúdo sem estudar até a prova.
  function avisoCoberturaDisciplina(discId) {
    const d = D.disciplinaPorId(state, discId);
    if (!d) return '';
    const pend = (d.topicos || []).some(function (t) { return !t.orfao && t.status !== 'dominado' && t.status !== 'teoria_concluida'; });
    if (!pend) return '';
    const hoje = D.hojeISO();
    const temFuturo = doAtivo(state.agenda).some(function (x) { return x.disciplinaId === discId && x.data >= hoje; });
    return temFuturo ? '' : d.nome + ' ficou sem tempo no calendário e ainda tem tópicos pendentes';
  }

  // Cria/atualiza a regra de troca recorrente e regenera as semanas afetadas.
  function criarRegraTrocaRecorrente(bloco, discDe, discPara, alc) {
    if (!state.config.regrasAgenda) state.config.regrasAgenda = [];
    const dia = D.diaSemanaISO(bloco.data);
    const desde = alc === 'todos' ? null : D.segundaDaSemana(bloco.data);
    // não empilha regra idêntica (mesmo dia/origem/alcance): substitui o destino
    state.config.regrasAgenda = state.config.regrasAgenda.filter(function (r) {
      return !(r.planoId === state.planoAtivoId && r.diaSemana === dia && r.de === discDe && (r.desde || null) === (desde || null));
    });
    state.config.regrasAgenda.push({
      id: window.Store.novoId('rga'), planoId: state.planoAtivoId,
      diaSemana: dia, de: discDe, para: discPara, desde: desde
    });
    regenerarAgendaFuturas();
    salvar(); fecharModal(); render();
    const dPara = D.disciplinaPorId(state, discPara);
    const aviso = avisoCoberturaDisciplina(discDe);
    toast('Estudo de ' + nomeDiaSemana(bloco.data) + ' agora é ' + (dPara ? dPara.nome : discPara) +
      (aviso ? ' · ⚠️ ' + aviso : ''), aviso ? 'erro' : 'sucesso');
  }

  function disciplinasPausadasPlano() {
    return state.disciplinas.filter(function (d) {
      return D.statusDisciplinaPlanejamento(d) === D.STATUS_DISCIPLINA.PAUSADA;
    });
  }

  function snapshotAjusteAgenda() {
    const entrada = entradaPlanoAtivo();
    return {
      agenda: clonarJson(doAtivo(state.agenda)),
      cronogramas: clonarJson(entrada ? entrada.cronogramas : {}),
      statusDisciplinas: state.disciplinas.map(function (d) {
        return {
          id: d.id,
          planejamentoStatus: d.planejamentoStatus,
          pausadaEm: d.pausadaEm,
          pausaOperacaoId: d.pausaOperacaoId,
          pausaAlcance: d.pausaAlcance,
          pausaMotivo: d.pausaMotivo,
          pausaModo: d.pausaModo,
          pausaSemanas: d.pausaSemanas,
          pausaReativarEm: d.pausaReativarEm,
          reativadaEm: d.reativadaEm,
          retomadaModo: d.retomadaModo
        };
      }),
      regrasAgenda: clonarJson((state.config && state.config.regrasAgenda) || [])
    };
  }

  function registrarHistoricoAjuste(previa, resultado, snapshot) {
    state.config = state.config || {};
    const registro = {
      id: resultado.operacaoId,
      planoId: state.planoAtivoId,
      aplicadoEm: new Date().toISOString(),
      tipo: previa.tipo,
      alcance: previa.alcance,
      disciplinaId: previa.disciplinaId,
      disciplinaNome: previa.disciplinaNome,
      blocosAfetados: previa.blocosAfetados,
      totalLiberadoMin: previa.totalLiberadoMin,
      totalRedistribuidoMin: previa.totalRedistribuidoMin,
      naoAlocadoMin: previa.naoAlocadoMin,
      pausaModo: previa.pausaModo,
      pausaSemanas: previa.pausaSemanas,
      pausaReativarEm: previa.pausaReativarEm,
      motivo: previa.tipo === 'substituir' ? 'substituição de disciplina' : 'pausa de disciplina'
    };
    if (!Array.isArray(state.config.historicoAjustesAgenda)) state.config.historicoAjustesAgenda = [];
    state.config.historicoAjustesAgenda.push(registro);
    state.config.historicoAjustesAgenda = state.config.historicoAjustesAgenda.slice(-50);
    state.config.ultimoAjusteAgenda = {
      planoId: state.planoAtivoId,
      registro: registro,
      snapshot: snapshot
    };
  }

  function desfazerUltimoAjusteAgenda() {
    const ultimo = state.config && state.config.ultimoAjusteAgenda;
    if (!ultimo || ultimo.planoId !== state.planoAtivoId || !ultimo.snapshot) return;
    confirmar({
      titulo: 'Desfazer último ajuste?',
      mensagem: 'O cronograma e os estados das disciplinas voltarão ao ponto anterior. Sessões e revisões não serão alteradas.',
      confirmar: 'Desfazer'
    }).then(function (ok) {
      if (!ok) return;
      const snap = ultimo.snapshot;
      state.agenda = state.agenda.filter(function (a) {
        return a.planoId && a.planoId !== state.planoAtivoId;
      }).concat(clonarJson(snap.agenda || []));
      const entrada = entradaPlanoAtivo();
      if (entrada) entrada.cronogramas = clonarJson(snap.cronogramas || {});
      const porId = {};
      (snap.statusDisciplinas || []).forEach(function (s) { porId[s.id] = s; });
      state.disciplinas.forEach(function (d) {
        const s = porId[d.id];
        if (!s) return;
        ['planejamentoStatus', 'pausadaEm', 'pausaOperacaoId', 'pausaAlcance', 'pausaMotivo',
          'pausaModo', 'pausaSemanas', 'pausaReativarEm', 'reativadaEm', 'retomadaModo'].forEach(function (campo) {
          if (s[campo] === undefined) delete d[campo]; else d[campo] = s[campo];
        });
      });
      state.config.regrasAgenda = clonarJson(snap.regrasAgenda || []);
      state.config.historicoAjustesAgenda.push({
        id: window.Store.novoId('undo'),
        planoId: state.planoAtivoId,
        aplicadoEm: new Date().toISOString(),
        tipo: 'undo',
        desfazOperacaoId: ultimo.registro && ultimo.registro.id
      });
      state.config.historicoAjustesAgenda = state.config.historicoAjustesAgenda.slice(-50);
      state.config.ultimoAjusteAgenda = null;
      window.Store.hidratar(state);
      salvar(); render();
      toast('Ajuste desfeito. Sessões e revisões foram preservadas.', 'sucesso');
    });
  }

  function ajustesAgendaHtml() {
    const pausadas = disciplinasPausadasPlano();
    const ultimo = state.config && state.config.ultimoAjusteAgenda;
    if (pausadas.length === 0 && (!ultimo || ultimo.planoId !== state.planoAtivoId)) return '';
    return '<div class="card ajustes-agenda-card">' +
      '<div class="ajustes-agenda-info">' +
      (pausadas.length > 0
        ? '<strong>' + pausadas.length + ' disciplina' + (pausadas.length > 1 ? 's pausadas' : ' pausada') + '</strong>' +
          '<span class="sub">O conteúdo pendente continua guardado e fora da distribuição.</span>'
        : '<strong>Planejamento ajustado</strong><span class="sub">Você pode desfazer a última alteração.</span>') +
      '</div><div class="ajustes-agenda-acoes">' +
      (pausadas.length > 0 ? '<button type="button" class="botao-mini botao-secundario" id="pl-gerenciar-pausadas">Gerenciar</button>' : '') +
      (ultimo && ultimo.planoId === state.planoAtivoId ? '<button type="button" class="botao-mini botao-quieto" id="pl-desfazer-ajuste">Desfazer</button>' : '') +
      '</div></div>';
  }

  function descricaoPrazoPausa(disciplina) {
    if (disciplina && disciplina.pausaReativarEm) {
      return 'Volta automaticamente em ' + D.formatarDataBR(disciplina.pausaReativarEm);
    }
    return 'Pausa manual';
  }

  function reativarDisciplinasPlanejamento(ids, modo) {
    const hoje = D.hojeISO();
    const reativadas = [];
    (ids || []).forEach(function (id) {
      const antes = D.disciplinaPorId(state, id);
      if (!antes) return;
      const operacaoPausaId = antes.pausaOperacaoId;
      if (!D.reativarDisciplina(state, id, { modo: modo || 'manual', data: hoje })) return;
      if (operacaoPausaId) {
        state.agenda = state.agenda.filter(function (b) {
          return !(b && b.origemAjusteId === operacaoPausaId && b.data >= hoje &&
            !blocoAgendaConcluido(b) && blocoFeitoMin(b) === 0);
        });
      }
      reativadas.push(id);
      if (!Array.isArray(state.config.historicoAjustesAgenda)) state.config.historicoAjustesAgenda = [];
      state.config.historicoAjustesAgenda.push({
        id: window.Store.novoId('reativar'),
        planoId: state.planoAtivoId,
        aplicadoEm: new Date().toISOString(),
        tipo: 'reativar',
        disciplinaId: id,
        modo: modo || 'manual'
      });
    });
    if (!reativadas.length) return reativadas;
    state.config.historicoAjustesAgenda = state.config.historicoAjustesAgenda.slice(-50);
    const recalculado = recalcularPlanoAdaptativo(true);
    if (!recalculado) {
      regenerarAgendaFuturas();
      salvar();
    }
    return reativadas;
  }

  function processarPausasVencidas() {
    const hoje = D.hojeISO();
    const vencidas = disciplinasPausadasPlano().filter(function (d) {
      return D.pausaDisciplinaExpirada(d, hoje);
    });
    if (!vencidas.length) return [];
    const nomes = vencidas.map(function (d) { return d.nome; });
    const reativadas = reativarDisciplinasPlanejamento(vencidas.map(function (d) { return d.id; }), 'prazo');
    if (reativadas.length) {
      toast((reativadas.length === 1 ? nomes[0] : reativadas.length + ' disciplinas') +
        ' voltou ao planejamento automaticamente.', 'sucesso');
    }
    return reativadas;
  }

  function abrirGerenciarDisciplinasPausadas() {
    const pausadas = disciplinasPausadasPlano();
    if (!pausadas.length) { toast('Não há disciplinas pausadas.'); return; }
    const linhas = pausadas.map(function (d) {
      return '<div class="pausada-linha"><span class="pausada-cor" style="background:' + esc(d.cor || '#9A9DA3') + '"></span>' +
        '<div><strong>' + esc(d.nome) + '</strong><span class="sub">Pausada · ' +
        D.formatarMin(D.minutosPendentesDisciplina(d)) + ' pendentes · ' + esc(descricaoPrazoPausa(d)) + '</span></div>' +
        '<button type="button" class="botao-mini botao-secundario" data-reativar-disc="' + esc(d.id) + '">Reativar</button></div>';
    }).join('');
    const m = abrirModal(
      '<h3>Disciplinas pausadas</h3>' +
      '<p class="sub">Ao reativar, o conteúdo ainda pendente volta automaticamente ao planejamento.</p>' +
      '<div class="pausadas-lista">' + linhas + '</div>' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="pausadas-fechar">Fechar</button></div>'
    );
    m.querySelector('#pausadas-fechar').addEventListener('click', fecharModal);
    m.querySelectorAll('[data-reativar-disc]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-reativar-disc');
        if (!reativarDisciplinasPlanejamento([id], 'manual').length) return;
        fecharModal();
        render();
        const d = D.disciplinaPorId(state, id);
        toast((d ? d.nome : id) + ' reativada e reinserida no planejamento.', 'sucesso');
      });
    });
  }

  function abrirAjusteDisciplina(blocoId, tipo) {
    const bloco = state.agenda.find(function (b) { return b.id === blocoId; });
    if (!bloco || blocoAgendaConcluido(bloco) || blocoFeitoMin(bloco) > 0) {
      toast('Blocos concluídos ou já iniciados não podem ser alterados.', 'erro');
      return;
    }
    const origem = D.disciplinaPorId(state, bloco.disciplinaId);
    if (!origem) return;
    const candidatos = state.disciplinas.filter(function (d) {
      return d.id !== origem.id && D.disciplinaAtivaPlanejamento(d) && D.minutosPendentesDisciplina(d) > 0;
    });
    const inicioPausa = bloco.data > D.hojeISO() ? bloco.data : D.hojeISO();
    const fluxo = {
      alcance: 'bloco',
      destino: 'automatico',
      destinos: [],
      pausaModo: 'semanas',
      pausaSemanas: 2,
      pausaAte: D.addDias(inicioPausa, 14)
    };
    const m = abrirModal('');
    m.classList.add('modal-ajuste-agenda');

    function opcaoRadio(nome, valor, titulo, sub, checked) {
      return '<label class="enf-op"><input type="radio" name="' + nome + '" value="' + valor + '"' + (checked ? ' checked' : '') + '>' +
        '<span class="enf-op-txt"><strong>' + titulo + '</strong><span class="sub">' + sub + '</span></span></label>';
    }

    function passo1() {
      m.innerHTML =
        '<div class="ajuste-etapa">Etapa 1 de 3 · Alcance</div>' +
        '<h3>' + (tipo === 'substituir' ? 'Substituir' : 'Pausar') + ' ' + esc(origem.nome) + '</h3>' +
        '<p class="sub">Blocos concluídos ou já iniciados ficam protegidos.</p>' +
        '<div class="enf-opcoes">' +
        opcaoRadio('aj-alc', 'bloco', 'Somente este bloco', D.formatarDataBR(bloco.data) + ' · ' + D.formatarMin(bloco.duracaoMin || 0), fluxo.alcance === 'bloco') +
        opcaoRadio('aj-alc', 'semana', 'Restante desta semana', 'Deste bloco até domingo, sem tocar no que já foi estudado.', fluxo.alcance === 'semana') +
        opcaoRadio('aj-alc', 'futuro', 'Todos os blocos futuros', 'Retira os blocos futuros e permite definir quando a disciplina volta.', fluxo.alcance === 'futuro') +
        '</div>' +
        '<div class="ajuste-prazo" data-aj-prazo>' +
        '<h4>Quando a disciplina deve voltar?</h4>' +
        '<div class="enf-opcoes ajuste-prazo-opcoes">' +
        opcaoRadio('aj-prazo', 'semanas', 'Após algumas semanas', 'O retorno e o recálculo serão automáticos.', fluxo.pausaModo === 'semanas') +
        opcaoRadio('aj-prazo', 'data', 'Em uma data específica', 'A disciplina volta automaticamente na data escolhida.', fluxo.pausaModo === 'data') +
        opcaoRadio('aj-prazo', 'manual', 'Somente quando eu reativar', 'Mantém o comportamento manual, sem prazo.', fluxo.pausaModo === 'manual') +
        '</div>' +
        '<div class="ajuste-prazo-campo" data-aj-prazo-campo="semanas"><label for="aj-pausa-semanas">Quantidade de semanas</label>' +
        '<input id="aj-pausa-semanas" type="number" min="1" max="52" value="' + esc(fluxo.pausaSemanas) + '"></div>' +
        '<div class="ajuste-prazo-campo" data-aj-prazo-campo="data"><label for="aj-pausa-data">Reativar em</label>' +
        '<input id="aj-pausa-data" type="date" min="' + esc(D.addDias(inicioPausa, 1)) + '" value="' + esc(fluxo.pausaAte) + '">' +
        '<span class="sub">O cronograma será recalculado automaticamente nesta data.</span></div>' +
        '</div>' +
        '<div class="modal-acoes"><button type="button" class="botao-quieto" data-aj-cancelar>Cancelar</button>' +
        '<button type="button" data-aj-proximo>Continuar</button></div>';
      function atualizarPrazoVisivel() {
        const alcance = m.querySelector('input[name="aj-alc"]:checked');
        const prazo = m.querySelector('[data-aj-prazo]');
        if (prazo) prazo.hidden = !alcance || alcance.value !== 'futuro';
        const modo = m.querySelector('input[name="aj-prazo"]:checked');
        m.querySelectorAll('[data-aj-prazo-campo]').forEach(function (el) {
          el.hidden = !modo || el.getAttribute('data-aj-prazo-campo') !== modo.value;
        });
      }
      m.querySelectorAll('input[name="aj-alc"], input[name="aj-prazo"]').forEach(function (r) {
        r.addEventListener('change', atualizarPrazoVisivel);
      });
      atualizarPrazoVisivel();
      m.querySelector('[data-aj-cancelar]').addEventListener('click', fecharModal);
      m.querySelector('[data-aj-proximo]').addEventListener('click', function () {
        const sel = m.querySelector('input[name="aj-alc"]:checked');
        fluxo.alcance = sel ? sel.value : 'bloco';
        if (fluxo.alcance === 'futuro') {
          const prazoSel = m.querySelector('input[name="aj-prazo"]:checked');
          fluxo.pausaModo = prazoSel ? prazoSel.value : 'semanas';
          fluxo.pausaSemanas = Math.max(1, Math.min(52,
            parseInt((m.querySelector('#aj-pausa-semanas') || {}).value, 10) || 1));
          fluxo.pausaAte = (m.querySelector('#aj-pausa-data') || {}).value || '';
          if (fluxo.pausaModo === 'data' && (!fluxo.pausaAte || fluxo.pausaAte <= inicioPausa)) {
            toast('Escolha uma data de retorno posterior ao início da pausa.', 'erro');
            return;
          }
        }
        passo2();
      });
    }

    function passo2() {
      const opcoesDisc = candidatos.map(function (d) {
        return '<option value="' + esc(d.id) + '">' + esc(d.nome) + ' · ' + D.formatarMin(D.minutosPendentesDisciplina(d)) + ' pendentes</option>';
      }).join('');
      const checks = candidatos.map(function (d) {
        return '<label class="ajuste-check"><input type="checkbox" value="' + esc(d.id) + '" data-aj-multi> ' +
          '<span><strong>' + esc(d.nome) + '</strong><span class="sub">' + D.formatarMin(D.minutosPendentesDisciplina(d)) + ' pendentes</span></span></label>';
      }).join('');
      m.innerHTML =
        '<div class="ajuste-etapa">Etapa 2 de 3 · Destino das horas</div>' +
        '<h3>Como redistribuir o tempo?</h3>' +
        '<div class="enf-opcoes">' +
        opcaoRadio('aj-dest', 'automatico', 'Redistribuição automática', 'Prioriza déficit, peso, dificuldade e conteúdo pendente.', fluxo.destino === 'automatico') +
        opcaoRadio('aj-dest', 'disciplina', 'Escolher uma disciplina', 'Direciona o tempo até o limite da carga pendente.', fluxo.destino === 'disciplina') +
        opcaoRadio('aj-dest', 'varias', 'Dividir entre disciplinas', 'Distribui apenas entre as matérias selecionadas.', fluxo.destino === 'varias') +
        '</div>' +
        (candidatos.length
          ? '<div class="ajuste-destino-detalhe" data-aj-detalhe="disciplina"><label for="aj-disc">Disciplina substituta</label><select id="aj-disc">' + opcoesDisc + '</select></div>' +
            '<div class="ajuste-destino-detalhe" data-aj-detalhe="varias"><span class="ajuste-label">Disciplinas receptoras</span><div class="ajuste-checks">' + checks + '</div></div>'
          : '<div class="ajuste-aviso">Nenhuma disciplina ativa tem conteúdo pendente. O tempo poderá ficar livre, sem criar progresso artificial.</div>') +
        '<div class="modal-acoes"><button type="button" class="botao-quieto" data-aj-voltar>Voltar</button>' +
        '<button type="button" data-aj-previa>Revisar prévia</button></div>';
      function pintarDestino() {
        const sel = m.querySelector('input[name="aj-dest"]:checked');
        fluxo.destino = sel ? sel.value : 'automatico';
        m.querySelectorAll('[data-aj-detalhe]').forEach(function (el) {
          el.hidden = el.getAttribute('data-aj-detalhe') !== fluxo.destino;
        });
      }
      m.querySelectorAll('input[name="aj-dest"]').forEach(function (r) { r.addEventListener('change', pintarDestino); });
      pintarDestino();
      m.querySelector('[data-aj-voltar]').addEventListener('click', passo1);
      m.querySelector('[data-aj-previa]').addEventListener('click', function () {
        const sel = m.querySelector('input[name="aj-dest"]:checked');
        fluxo.destino = sel ? sel.value : 'automatico';
        if (fluxo.destino === 'disciplina') {
          const disc = m.querySelector('#aj-disc');
          fluxo.destinos = disc && disc.value ? [disc.value] : [];
        } else if (fluxo.destino === 'varias') {
          fluxo.destinos = Array.from(m.querySelectorAll('[data-aj-multi]:checked')).map(function (x) { return x.value; });
          if (!fluxo.destinos.length) { toast('Selecione ao menos uma disciplina.', 'erro'); return; }
        } else fluxo.destinos = [];
        const previa = D.simularAjusteAgenda(state, {
          blocoId: bloco.id,
          tipo: tipo,
          alcance: fluxo.alcance,
          disciplinasDestino: fluxo.destinos,
          hoje: D.hojeISO(),
          minutosSemana: totalMinutosRotina(rotinaEstudosAtual()),
          pausaModo: fluxo.pausaModo,
          pausaSemanas: fluxo.pausaSemanas,
          pausaAte: fluxo.pausaAte
        });
        passo3(previa);
      });
    }

    function passo3(previa) {
      if (!previa.ok) { toast(previa.erro || 'Não foi possível gerar a prévia.', 'erro'); passo1(); return; }
      const destinos = previa.destinatarios.length
        ? previa.destinatarios.map(function (d) {
          return '<li><span>' + esc(d.nome) + '</span><strong>' + D.formatarMin(d.minutos) + '</strong></li>';
        }).join('')
        : '<li><span>Nenhuma disciplina</span><strong>tempo livre</strong></li>';
      const v = previa.viabilidade;
      const viabilidadeHtml = v.viavel
        ? '<div class="ajuste-viabilidade ok">A conclusão prevista do edital foi mantida.</div>'
        : '<div class="ajuste-viabilidade alerta">' +
          (v.dataFinal
            ? 'Com este ajuste, faltarão aproximadamente <strong>' + D.formatarMin(v.deficitMin) + '</strong> para concluir o edital até ' + D.formatarDataBR(v.dataFinal) + '.'
            : 'Não há data final ou capacidade semanal suficiente para estimar a conclusão.') + '</div>';
      const retornoHtml = previa.marcarPausada
        ? '<div><span>Retorno da disciplina</span><strong>' +
          (previa.pausaReativarEm
            ? 'Automático em ' + D.formatarDataBR(previa.pausaReativarEm)
            : 'Somente por reativação manual') + '</strong></div>'
        : '';
      m.innerHTML =
        '<div class="ajuste-etapa">Etapa 3 de 3 · Prévia</div>' +
        '<h3>Revise antes de confirmar</h3>' +
        '<div class="ajuste-resumo">' +
        '<div><span>Disciplina retirada</span><strong>' + esc(previa.disciplinaNome) + (previa.marcarPausada ? ' · será pausada' : '') + '</strong></div>' +
        '<div><span>Blocos afetados</span><strong>' + previa.blocosAfetados + '</strong></div>' +
        '<div><span>Horas liberadas</span><strong>' + D.formatarMin(previa.totalLiberadoMin) + '</strong></div>' +
        '<div><span>Redistribuído</span><strong>' + D.formatarMin(previa.totalRedistribuidoMin) + '</strong></div>' +
        retornoHtml +
        '</div><h4>Quem recebe as horas</h4><ul class="ajuste-destinos">' + destinos + '</ul>' +
        '<p class="sub ajuste-efeitos">Blocos: ' + previa.blocosRemovidos + ' substituídos/removidos · ' +
        previa.blocosAdicionados + ' adicionados · ' + previa.blocosRedimensionados + ' redimensionados.</p>' +
        (previa.naoAlocadoMin > 0 ? '<div class="ajuste-aviso">' + D.formatarMin(previa.naoAlocadoMin) + ' ficarão livres; não há conteúdo ativo suficiente para receber esse tempo.</div>' : '') +
        viabilidadeHtml +
        '<div class="modal-acoes"><button type="button" class="botao-quieto" data-aj-voltar>Voltar</button>' +
        '<button type="button"' + (!previa.podeAplicar ? ' disabled' : '') + ' data-aj-confirmar>Confirmar ajuste</button></div>';
      m.querySelector('[data-aj-voltar]').addEventListener('click', passo2);
      m.querySelector('[data-aj-confirmar]').addEventListener('click', function () {
        const snapshot = snapshotAjusteAgenda();
        const resultado = D.aplicarAjusteAgenda(state, previa, {
          criarId: function () { return window.Store.novoId('agd'); },
          operacaoId: window.Store.novoId('ajp'),
          aplicadaEm: D.hojeISO()
        });
        if (!resultado.ok) { toast(resultado.erro || 'Não foi possível aplicar o ajuste.', 'erro'); return; }
        registrarHistoricoAjuste(previa, resultado, snapshot);
        salvar(); fecharModal(); render();
        const retorno = previa.pausaReativarEm ? ' até ' + D.formatarDataBR(previa.pausaReativarEm) : '';
        toast(previa.disciplinaNome + (previa.marcarPausada ? ' pausada' + retorno : ' ajustada') +
          ' · ' + D.formatarMin(previa.totalRedistribuidoMin) + ' redistribuídos.', 'sucesso');
      });
    }
    passo1();
  }

  function abrirMenuAcoesBloco(blocoId) {
    const bloco = state.agenda.find(function (b) { return b.id === blocoId; });
    if (!bloco) return;
    if (blocoAgendaConcluido(bloco) || blocoFeitoMin(bloco) > 0) {
      toast('Este bloco já foi iniciado e está protegido.', 'erro');
      return;
    }
    const d = D.disciplinaPorId(state, bloco.disciplinaId);
    const m = abrirModal(
      '<h3>' + esc(d ? d.nome : bloco.disciplinaId) + '</h3>' +
      '<p class="sub">' + D.formatarDataBR(bloco.data) + ' · ' + D.formatarMin(bloco.duracaoMin || 0) + '</p>' +
      '<div class="modal-acoes modal-acoes-coluna">' +
      '<button type="button" id="bl-ac-substituir">Substituir disciplina</button>' +
      '<button type="button" class="botao-secundario" id="bl-ac-pausar">Pausar disciplina</button>' +
      '<button type="button" class="botao-quieto" id="bl-ac-mover">Mover ou editar bloco</button>' +
      '<button type="button" class="botao-quieto" id="bl-ac-remover">Remover bloco</button>' +
      '<button type="button" class="botao-quieto" id="bl-ac-cancelar">Cancelar</button></div>'
    );
    m.querySelector('#bl-ac-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#bl-ac-substituir').addEventListener('click', function () { fecharModal(); abrirAjusteDisciplina(blocoId, 'substituir'); });
    m.querySelector('#bl-ac-pausar').addEventListener('click', function () { fecharModal(); abrirAjusteDisciplina(blocoId, 'pausar'); });
    m.querySelector('#bl-ac-mover').addEventListener('click', function () { fecharModal(); abrirBlocoAgenda(blocoId); });
    m.querySelector('#bl-ac-remover').addEventListener('click', function () {
      confirmar({ titulo: 'Remover este bloco?', mensagem: 'Sessões e revisões existentes não serão apagadas.', confirmar: 'Remover', perigo: true }).then(function (ok) {
        if (!ok) return;
        state.agenda = state.agenda.filter(function (x) { return x.id !== blocoId; });
        salvar(); fecharModal(); render(); toast('Bloco removido.');
      });
    });
  }

  function abrirNovaDisciplina() {
    garantirPlanoAtivo();
    const cores = ['#2454D6', '#1F7A4D', '#B8762B', '#8E44AD', '#C0392B', '#0E7490', '#5B6B2F', '#99357F'];
    const cor = cores[state.disciplinas.length % cores.length];
    const m = abrirModal(
      '<h3>Nova disciplina</h3>' +
      '<p style="font-size:0.85rem;color:var(--grafite)">Para organizar seus estudos sem plano importado. Ela ganha um tópico "Geral" para registrar sessões.</p>' +
      '<form id="form-disc">' +
      '<label for="nd-nome">Nome</label><input id="nd-nome" type="text" placeholder="Ex.: Direito Constitucional" required maxlength="60">' +
      '<div class="grade-2">' +
      '<div><label for="nd-sigla">Sigla (2–4 letras)</label><input id="nd-sigla" type="text" maxlength="4" style="text-transform:uppercase" placeholder="CON" required></div>' +
      '<div><label for="nd-cor">Cor</label><input id="nd-cor" type="color" value="' + cor + '"></div></div>' +
      '<label for="nd-topicos">Assuntos iniciais (opcional)</label><textarea id="nd-topicos" rows="5" placeholder="Ex.: Aula 1 - conceitos basicos\nLista de exercicios\nRevisao para prova"></textarea>' +
      '<div class="msg-erro oculto" id="nd-erro"></div>' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="nd-cancelar">Cancelar</button>' +
      '<button type="submit">Criar disciplina</button></div></form>'
    );
    const nomeEl = m.querySelector('#nd-nome');
    const siglaEl = m.querySelector('#nd-sigla');
    nomeEl.addEventListener('input', function () {
      if (siglaEl.dataset.editada) return;
      siglaEl.value = nomeEl.value.replace(/[^A-Za-z\u00C0-\u017F]/g, '').slice(0, 3).toUpperCase();
    });
    siglaEl.addEventListener('input', function () { siglaEl.dataset.editada = '1'; });
    m.querySelector('#nd-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#form-disc').addEventListener('submit', function (e) {
      e.preventDefault();
      const erroEl = m.querySelector('#nd-erro');
      const nome = nomeEl.value.trim();
      const sigla = siglaEl.value.trim().toUpperCase();
      if (!/^[A-Z\u00C0-\u017F]{2,4}$/.test(sigla)) { erroEl.textContent = 'Sigla deve ter de 2 a 4 letras.'; erroEl.classList.remove('oculto'); return; }
      if (D.disciplinaPorId(state, sigla)) { erroEl.textContent = 'Já existe uma disciplina com a sigla ' + sigla + '.'; erroEl.classList.remove('oculto'); return; }
      const topicosTexto = m.querySelector('#nd-topicos').value.split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 40);
      const topicos = (topicosTexto.length ? topicosTexto : ['Geral']).map(function (top, i) {
        return { id: sigla + '-' + String(i + 1).padStart(2, '0'), nome: top, incidencia_pct: 0, prioridade: 2, horas_estimadas: 1, semana_sugerida: null, status: 'pendente', reaberto: false, orfao: false };
      });
      state.disciplinas.push({
        id: sigla, nome: nome, cor: m.querySelector('#nd-cor').value, peso: 1, base_teorica: 'pdf',
        topicos: topicos
      });
      salvar(); fecharModal(); render();
      toast('Disciplina ' + sigla + ' criada', 'sucesso');
    });
  }

  function abrirGerenciarDisciplinas() {
    const disciplinas = state.disciplinas.filter(function (d) { return d && d.id !== 'ORF'; });
    if (!disciplinas.length) { toast('Não há disciplinas para excluir.'); return; }
    const linhas = disciplinas.map(function (d) {
      const topicos = (d.topicos || []).filter(function (t) { return t && !t.orfao; }).length;
      const status = D.statusDisciplinaPlanejamento(d) === D.STATUS_DISCIPLINA.PAUSADA ? ' · pausada' : '';
      return '<div class="disciplina-gerenciar-linha">' +
        '<span class="disciplina-gerenciar-cor" style="background:' + esc(d.cor || '#9A9DA3') + '"></span>' +
        '<div><strong>' + esc(d.nome) + '</strong><span class="sub">' + esc(d.id) + ' · ' + topicos +
        ' assunto' + (topicos === 1 ? '' : 's') + status + '</span></div>' +
        '<button type="button" class="botao-mini botao-perigo" data-excluir-disc="' + esc(d.id) + '">Excluir</button></div>';
    }).join('');
    const m = abrirModal(
      '<h3>Gerenciar disciplinas</h3>' +
      '<p class="sub">Exclua matérias que não fazem mais parte deste plano.</p>' +
      '<div class="disciplinas-gerenciar-lista">' + linhas + '</div>' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="disciplinas-fechar">Fechar</button></div>'
    );
    m.querySelector('#disciplinas-fechar').addEventListener('click', fecharModal);
    m.querySelectorAll('[data-excluir-disc]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-excluir-disc');
        const disciplina = D.disciplinaPorId(state, id);
        if (!disciplina) return;
        const topicos = (disciplina.topicos || []).filter(function (t) { return t && !t.orfao; }).length;
        confirmar({
          titulo: 'Excluir ' + disciplina.nome + '?',
          mensagem: 'A disciplina, seus ' + topicos + ' assunto' + (topicos === 1 ? '' : 's') +
            ', blocos, revisões e histórico de estudo serão removidos deste plano. Esta ação não tem volta.',
          confirmar: 'Excluir disciplina',
          perigo: true,
          icone: '🗑️'
        }).then(function (ok) {
          if (!ok) return;
          const resultado = D.excluirDisciplina(state, id);
          if (!resultado.ok) { toast('Não foi possível excluir a disciplina.', 'erro'); return; }
          window.Store.marcarRemovido(state, resultado.idsRemovidos);
          // Cronômetro rodando num assunto da disciplina que saiu: mesmo caso do
          // plano excluído — o tempo não tem mais onde ser registrado.
          const timerDescartado = sanearTimerOrfao({ forcar: true, silencioso: true });
          salvar(); fecharModal(); render();
          toast(resultado.disciplinaNome + ' excluída do plano.' +
            (timerDescartado ? ' Cronômetro em aberto descartado.' : ''), 'sucesso');
        });
      });
    });
  }

  function rotuloRitmo(chave, dados) {
    const mapa = {
      sustentavel: 'Sustentável',
      hardcore: 'Hardcore',
      plano_ativo: 'Plano gerado',
      plano_3m: 'Acelerado',
      plano_6m: 'Equilibrado',
      plano_9m: 'Sustentável'
    };
    let base;
    if (chave === 'plano_ativo' && dados && dados.meses) {
      base = dados.nomeRitmo || nomeRitmoPorMeses(entradaPlanoAtivo(), dados.meses);
    } else {
      base = mapa[chave] || chave.replace(/_/g, ' ');
    }
    const horas = dados && (dados.h_semana || dados.h_semana_exigidas);
    return base + (horas ? ' · ' + horas + 'h/semana' : '');
  }

  function ritmosDisponiveis() {
    const chaves = new Set();
    if (state.cronogramas) Object.keys(state.cronogramas).forEach(function (k) { chaves.add(k); });
    if (state.plano && state.plano.ritmos) Object.keys(state.plano.ritmos).forEach(function (k) {
      if (typeof state.plano.ritmos[k] === 'object') chaves.add(k);
    });
    return Array.from(chaves).filter(function (k) {
      return state.cronogramas && state.cronogramas[k] && state.cronogramas[k].length > 0;
    });
  }

  // [Nome do Plano] + [Carga Horária Semanal] para exibir abaixo do Ritmo ativo
  function nomePlanoComCarga(dados) {
    if (!dados) return '';
    const nome = dados.meses ? 'Plano ' + (dados.nomeRitmo || nomeRitmoPorMeses(entradaPlanoAtivo(), dados.meses)) : (state.plano ? state.plano.concurso : 'Plano');
    const horas = dados.h_semana || dados.h_semana_exigidas;
    return nome + (horas ? ' · ' + horas + 'h por semana' : '');
  }

  // Foto 3x4 do órgão para o card "Plano atual": usa a foto semeada na criação
  // do plano e, na falta dela, procura o edital correspondente no catálogo.
  function fotoPlanoAtivoHtml() {
    const plano = state.plano;
    if (!plano) return '';
    let src = plano.foto || '';
    if (!src) {
      const ed = editaisDoCatalogo().find(function (e) { return e.titulo === plano.concurso; });
      if (ed) src = ed.foto || ed.fotoUrl || ed.imagem || '';
    }
    const iniciais = String(plano.orgao || plano.concurso || 'ED').replace(/[^0-9A-Za-zÀ-ſ ]/g, ' ').trim().split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0); }).join('').toUpperCase() || 'ED';
    const onerr = "var s=this.parentNode;s.classList.add('catalogo-foto-placeholder');s.setAttribute('aria-hidden','true');s.textContent='" + esc(iniciais) + "';";
    return src
      ? '<span class="catalogo-foto plano-atual-foto"><img src="' + esc(src) + '" alt="" onerror="' + esc(onerr) + '"></span>'
      : '<span class="catalogo-foto catalogo-foto-placeholder plano-atual-foto" aria-hidden="true">' + esc(iniciais) + '</span>';
  }

  function planoAtualHtml() {
    if (!state.plano) {
      return '<div class="card planejamento-card plano-atual-card"><div class="card-kpi-rotulo">Plano atual</div>' +
        '<h3>Sem plano ativo</h3><p class="sub">Escolha um edital disponível acima e o sistema gera seu plano personalizado — ou crie um plano manual.</p>' +
        '<div class="compact-actions"><button class="botao-mini" id="pl-em-branco">Plano manual</button></div></div>';
    }
    const progresso = D.progressoEdital(state);
    const editalNovo = atualizacaoEditalPendente(planoAtivoEntry());
    const avisoAtualizacao = editalNovo
      ? '<div class="plano-edital-atualizado"><span>📣 O edital deste plano foi atualizado. Atualize para receber novos tópicos sem perder seu progresso.</span>' +
        '<button class="botao-mini" id="pl-atualizar-edital">Atualizar plano</button></div>'
      : '';
    return '<div class="card planejamento-card plano-atual-card">' +
      '<div class="plano-atual-head">' + fotoPlanoAtivoHtml() + '<div><div class="card-kpi-rotulo">Plano atual</div>' +
      '<h3>' + esc(state.plano.concurso) + '</h3>' +
      '<p class="sub">' + esc(state.plano.banca || 'plano manual') + ' · ' + state.disciplinas.length + ' disciplinas · ' + progresso.total + ' tópicos</p></div>' +
      '<div class="plano-progresso num">' + progresso.pct + '%</div></div>' +
      '<div class="barra" style="margin:0.5rem 0 0.7rem"><span style="width:' + progresso.pct + '%"></span></div>' +
      avisoAtualizacao +
      '<div class="compact-actions plano-acoes-card">' +
      '<button class="botao-mini" id="pl-acao-editar">Editar plano</button>' +
      '<button class="botao-mini botao-secundario" id="pl-acao-edital">Edital</button>' +
      '<button class="botao-mini botao-perigo" id="pl-acao-excluir">Excluir</button>' +
      '</div>' +
      modoRetaFinalControleHtml() +
      modoAprofundamentoControleHtml() +
      (state.plano.combinado ? enfaseBannerHtml() : '') +
      '</div>';
  }

  // Controle do modo aprofundamento no card do plano. NÃO há ativação manual: o
  // modo é proposto automaticamente quando o aluno conclui todo o cronograma
  // (ver talvezConvidarAprofundamento). Aqui só mostramos o estado ativo + sair.
  // A reta final SOBREPÕE o aprofundamento (foco oposto): nas últimas semanas o
  // aprofundamento fica dormente e nem aparece aqui — quem manda é a reta final.
  function modoAprofundamentoControleHtml() {
    if (!(state.plano && state.plano.modoAprofundamento)) return '';
    if (D.retaFinalInfo(state, D.hojeISO()).ativa) return '';
    return '<div class="modo-controle modo-controle-aprof-ativo">' +
      '<span class="modo-controle-txt">🎓 <strong>Modo aprofundamento ativo</strong> — foco em reter e aprofundar o que mais cai.</span>' +
      '<button type="button" class="botao-mini botao-quieto" id="pl-aprof-desativar">Desativar</button></div>';
  }

  // Convite automático ao aprofundamento: ao concluir todo o cronograma (ou 100%
  // do edital) e ainda havendo tempo até a prova, parabeniza e oferece aprofundar.
  // Ao aceitar, subentende "já estudei" para TODOS os tópicos do plano e ativa o
  // modo. Aparece uma única vez por plano (flag aprofundamentoConvidado).
  function talvezConvidarAprofundamento() {
    if (!state.plano || state.plano.modoAprofundamento || state.plano.aprofundamentoConvidado) return false;
    const hoje = D.hojeISO();
    const sem = D.semanaCorrente(state, hoje);
    const prog = D.progressoEdital(state);
    const concluiu = (sem && sem.encerrado) || (prog.total > 0 && prog.pct === 100);
    if (!concluiu) return false;
    // precisa ainda haver tempo até a prova (sem data = há tempo) e não estar na reta final
    const prazo = D.prazoProva(state);
    if (prazo && prazo <= hoje) return false;
    if (D.retaFinalInfo(state, hoje).ativa) return false;

    state.plano.aprofundamentoConvidado = true;
    salvar();
    if (typeof confete === 'function') confete();
    const nome = nomeCurtoConcurso();
    let tempoTxt = 'ainda há tempo até a prova';
    if (prazo) {
      const semanas = Math.max(1, D.diffDias(hoje, prazo) / 7);
      tempoTxt = 'ainda falta ' + formatarEstimativaPrazo(semanas) + ' para a prova';
    }
    const m = abrirModal(
      '<div style="text-align:center">' +
      '<div style="font-size:2.6rem;line-height:1">🎉</div>' +
      '<h3 style="margin:0.4rem 0">Você concluiu o plano de ' + esc(nome) + '!</h3>' +
      '<p class="sub">Percorreu todo o cronograma — que jornada! Como <strong>' + esc(tempoTxt) + '</strong>, dá para transformar esse tempo extra em vantagem.</p>' +
      '<p class="sub">Que tal entrar no <strong>modo aprofundamento</strong>? Vou considerar todo o conteúdo como <strong>já estudado</strong> e focar em revisão espaçada, questões e nos tópicos que mais caem.</p>' +
      '<div class="modal-acoes" style="justify-content:center">' +
      '<button type="button" class="botao-quieto" id="aprof-depois">Agora não</button>' +
      '<button type="button" id="aprof-sim">Aprofundar conhecimentos 🎓</button></div></div>'
    );
    m.querySelector('#aprof-depois').addEventListener('click', fecharModal);
    m.querySelector('#aprof-sim').addEventListener('click', function () {
      state.plano.modoAprofundamento = true;
      delete state.plano.modoRetaFinal; // modos opostos
      // subentende "já estudei" para todos os tópicos do plano e agenda revisões
      const idsAprofundar = [];
      state.disciplinas.forEach(function (d) {
        if (d.id === 'ORF') return;
        (d.topicos || []).forEach(function (t) {
          if (t.orfao) return;
          if (t.status !== 'dominado') t.status = 'teoria_concluida';
          idsAprofundar.push(t.id);
        });
      });
      agendarRevisoesEmLote(idsAprofundar); // retroativo: pula 24h e escalona a base
      salvar(); fecharModal(); render();
      toast('Modo aprofundamento ativado 🎓 — bora reter e aprofundar!', 'sucesso');
    });
    return true;
  }

  // Controle do modo reta final dentro do card do plano (Planejamento).
  function modoRetaFinalControleHtml() {
    const rf = D.retaFinalInfo(state, D.hojeISO());
    if (rf.ativa) {
      const motivo = rf.manual
        ? 'ativado por você'
        : 'ligado automaticamente — falta ' + (rf.semanas <= 1 ? 'menos de 1 semana' : 'cerca de ' + rf.semanas + ' semanas');
      return '<div class="modo-controle modo-controle-ativo">' +
        '<span class="modo-controle-txt">🏁 <strong>Modo reta final ativo</strong> — ' + motivo + '.</span>' +
        (rf.manual ? '<button type="button" class="botao-mini botao-quieto" id="pl-reta-desativar">Desativar</button>' : '') +
        '</div>';
    }
    return '<div class="modo-controle">' +
      '<span class="modo-controle-txt">🏁 Prova chegando? O <strong>modo reta final</strong> foca tudo em questões, simulados e revisão do que mais cai.</span>' +
      '<button type="button" class="botao-mini botao-secundario" id="pl-reta-ativar">Ativar modo reta final</button></div>';
  }

  // Modal explicativo do modo reta final (com confirmação).
  function abrirModoRetaFinal() {
    if (!state.plano) { toast('Crie ou ative um plano primeiro.', 'erro'); return; }
    const m = abrirModal(
      '<h3>🏁 Modo reta final</h3>' +
      '<p class="sub">Ative quando a prova está chegando. O foco deixa de ser ver matéria nova e passa a ser <strong>consolidar</strong>:</p>' +
      '<ul class="modo-lista">' +
      '<li>📝 <strong>Mais questões e simulados</strong> — treinar do jeito da prova.</li>' +
      '<li>🔁 <strong>Revisão intensiva</strong> dos tópicos que mais caem e dos seus pontos fracos.</li>' +
      '<li>🎯 <strong>Menos teoria nova</strong>: a prioridade é fixar o que você já viu.</li>' +
      '</ul>' +
      '<p class="sub">Um painel no Hoje passa a guiar esse foco. Se a prova já tem data marcada, o modo liga sozinho nas últimas 6 semanas — aqui você pode ligar antes. Quer continuar?</p>' +
      '<div class="modal-acoes">' +
      '<button type="button" class="botao-quieto" id="reta-cancelar">Agora não</button>' +
      '<button type="button" id="reta-confirmar">Ativar modo reta final</button></div>'
    );
    m.querySelector('#reta-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#reta-confirmar').addEventListener('click', function () {
      state.plano.modoRetaFinal = true;
      delete state.plano.modoAprofundamento; // modos opostos: um desliga o outro
      salvar(); fecharModal(); render();
      toast('Modo reta final ativado 🏁', 'sucesso');
    });
  }

  // Card próprio para ritmo ativo + geração do plano (logo abaixo do plano atual)
  function ritmoCardHtml() {
    if (!state.plano) return '';
    const ritmos = ritmosDisponiveis();
    const ritmoAtual = state.plano.ritmoAtivo || ritmos[0] || 'sustentavel';
    const temPlanoGerado = ritmos.length > 0;
    const optsRitmo = ritmos.map(function (r) {
      const dados = state.plano.ritmos && state.plano.ritmos[r];
      return '<option value="' + esc(r) + '"' + (r === ritmoAtual ? ' selected' : '') + '>' + esc(rotuloRitmo(r, dados)) + '</option>';
    }).join('');
    return '<div class="card planejamento-card ritmo-card">' +
      (temPlanoGerado
        ? '<label for="pl-ritmo">Ritmo ativo</label><select id="pl-ritmo">' + optsRitmo + '</select>'
        : '<div class="card-kpi-rotulo">Plano de estudos</div><p class="sub" style="margin:0.2rem 0 0.6rem">Este plano ainda não tem cronograma gerado.</p>') +
      '<div class="compact-actions">' +
      '<button class="botao-mini" id="pl-gerar-ritmos">Gerar plano de estudos</button>' +
      // Regra: o botão de dificuldade só aparece depois que o plano é gerado
      (temPlanoGerado ? '<button class="botao-mini botao-quieto" id="pl-ajustar-perfil">Dificuldades</button>' : '') +
      '</div>' +
      '</div>';
  }

  function normalizarBusca(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  // opções únicas (Órgão / Cargo / Estado) presentes nos editais cadastrados
  function valoresUnicosEditais(campo) {
    const set = new Set();
    editaisDoCatalogo().forEach(function (e) {
      if (catalogoFiltro.tipo === 'carreira' && !ehPlanoCarreira(e)) return;
      if (catalogoFiltro.tipo === 'concurso' && ehPlanoCarreira(e)) return;
      if (e[campo]) set.add(e[campo]);
    });
    return Array.from(set).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  }

  function editalCorrespondeFiltro(e, filtro) {
    if (filtro.tipo === 'carreira' && !ehPlanoCarreira(e)) return false;
    if (filtro.tipo === 'concurso' && ehPlanoCarreira(e)) return false;
    if (filtro.orgao && (e.orgao || '') !== filtro.orgao) return false;
    if (filtro.cargo && (e.cargo || '') !== filtro.cargo) return false;
    if (filtro.estado && (e.estado || '') !== filtro.estado) return false;
    if (filtro.busca) {
      const alvo = normalizarBusca([e.titulo, e.banca, e.orgao, e.cargo, e.estado, e.cobertura, (e.baseEditais || []).join(' ')].join(' '));
      if (alvo.indexOf(normalizarBusca(filtro.busca)) < 0) return false;
    }
    return true;
  }

  // conteúdo da lista do modal (recalculado a cada mudança de filtro)
  function editaisListaHtml(filtro) {
    const lista = editaisDoCatalogo().filter(function (e) { return editalCorrespondeFiltro(e, filtro); });
    if (lista.length === 0) {
      return '<div class="estado-vazio editais-vazio"><span class="bolha bolha-pendente"></span>' +
        '<strong>Nenhum edital encontrado</strong>' +
        'Não encontrou seu edital? Faça um pedido.' +
        '<p style="margin-top:1rem">' +
        '<button class="botao" type="button" data-pedir-edital-modal>✉ Pedir este edital</button></p></div>';
    }
    return lista.map(function (e) {
      const jaTem = state.planos.some(function (p) { return p.plano.concurso === e.titulo; });
      const tags = [e.orgao, e.cargo, e.estado].filter(Boolean).map(function (t) {
        return '<span class="edital-tag">' + esc(t) + '</span>';
      }).join('');
      return '<div class="fila-item catalogo-item" data-ed-sel="' + esc(e.id) + '" role="button" tabindex="0">' +
        '<span class="bolha bolha-' + (jaTem ? 'teoria_concluida' : 'pendente') + '"></span>' +
        '<div class="fila-info"><div class="fila-titulo">' + esc(e.titulo) + '</div>' +
        (tags ? '<div class="edital-tags">' + tags + '</div>' : '') +
        '<div class="fila-sub">' + esc(e.banca || 'banca não informada') + ' · ' + (e.disciplinas || []).length + ' disciplinas · ' +
        contarTopicosEdital(e) + ' tópicos · corte estimado ' + (e.notaCorte || 70) + '%</div></div>' +
        (jaTem ? '<span class="etiqueta etiqueta-feito">plano criado ✓</span>' : '') +
        '</div>';
    }).join('');
  }

  // Banco de dados de teste: editais de alta concorrência para popular os filtros.
  function construirEditaisMock() {
    function t(id, nome, inc, h) {
      return { id: id, nome: nome, incidencia_pct: inc, prioridade: 2, horas_estimadas: h, semana_sugerida: null, status: 'pendente', reaberto: false, orfao: false };
    }
    function disc(id, nome, cor, peso, tops) {
      return { id: id, nome: nome, cor: cor, peso: peso, base_teorica: 'pdf', topicos: tops };
    }
    const base = [
      disc('POR', 'Língua Portuguesa', '#3B82F6', 2, [t('por-01', 'Interpretação de texto', 30, 4), t('por-02', 'Crase e regência', 18, 3), t('por-03', 'Concordância', 16, 3)]),
      disc('RLM', 'Raciocínio Lógico-Matemático', '#8B5CF6', 2, [t('rlm-01', 'Lógica proposicional', 22, 4), t('rlm-02', 'Análise combinatória', 14, 3)]),
      disc('DCONST', 'Direito Constitucional', '#EF4444', 3, [t('dc-01', 'Direitos fundamentais', 28, 5), t('dc-02', 'Organização do Estado', 16, 4)]),
      disc('DADM', 'Direito Administrativo', '#F59E0B', 3, [t('da-01', 'Atos administrativos', 24, 5), t('da-02', 'Licitações (Lei 14.133)', 26, 5)])
    ];
    return [
      { titulo: 'TRF3 — Técnico Judiciário - Área Administrativa 2026', banca: 'FCC', orgao: 'TRF3', cargo: 'Técnico Judiciário - Área Administrativa', estado: 'SP', notaCorte: 72, area: 'Administrativa', nivel: 'medio', emAlta: true, janelaProva: { inicio: '2026-11', fim: '2027-02' } },
      { titulo: 'TJ-RJ — Técnico de Atividade Judiciária 2026', banca: 'FGV', orgao: 'TJ-RJ', cargo: 'Técnico Judiciário', estado: 'RJ', notaCorte: 68, area: 'Judiciária', nivel: 'medio', emAlta: true, janelaProva: { inicio: '2026-10', fim: '2026-12' } },
      { titulo: 'Petrobras — Técnico(a) de Administração e Controle Jr', banca: 'Cebraspe', orgao: 'Petrobras', cargo: 'Técnico de Administração', estado: 'RJ', notaCorte: 65, area: 'Administração', nivel: 'dificil', emAlta: false, janelaProva: { inicio: '2027-03', fim: '2027-05' } }
    ].map(function (e, i) {
      return {
        id: 'edt-mock-' + i, titulo: e.titulo, banca: e.banca, orgao: e.orgao, cargo: e.cargo, estado: e.estado,
        notaCorte: e.notaCorte, area: e.area, nivel: e.nivel, emAlta: e.emAlta, janelaProva: e.janelaProva,
        arquivado: false, criadoEm: D.hojeISO(), mock: true,
        disciplinas: JSON.parse(JSON.stringify(base))
      };
    });
  }

  const UFS_BR = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

  // Órgão = trecho antes do primeiro separador do título (ex.: "TRF3 - Técnico..." → "TRF3")
  function orgaoDoTitulo(titulo) {
    const base = String(titulo || '').split(/\s[-–—]\s|\s[-–—]|—|\(/)[0].trim();
    return base.slice(0, 28);
  }

  // UF = primeira sigla de estado encontrada como palavra isolada no texto (ou '')
  function ufDoTexto(txt) {
    const toks = String(txt || '').toUpperCase().split(/[^A-Z\u00C0-\u017F0-9]+/);
    for (let i = 0; i < toks.length; i++) {
      if (UFS_BR.indexOf(toks[i]) >= 0) return toks[i];
    }
    return '';
  }

  // Preenche órgão/estado que não vieram no cadastro, para os filtros terem opções.
  function enriquecerEditais() {
    let mudou = false;
    (state.editais || []).forEach(function (e) {
      if (!e.orgao) { const o = orgaoDoTitulo(e.titulo); if (o) { e.orgao = o; mudou = true; } }
      if (!e.estado) { const uf = ufDoTexto(e.titulo) || ufDoTexto(e.cargo); if (uf) { e.estado = uf; mudou = true; } }
    });
    return mudou;
  }

  function garantirEditaisMock() {
    if (!Array.isArray(state.editais)) state.editais = [];
    if (enriquecerEditais()) {
      salvar({ sincronizar: false });
    }
  }

  function abrirEditaisDisponiveis() {
    garantirEditaisMock();
    const filtro = { orgao: '', cargo: '', estado: '', busca: '' };
    // só mostra um filtro quando há ao menos uma opção real para ele (evita menu vazio)
    function selectFiltro(campo, id, rotulo) {
      const valores = valoresUnicosEditais(campo);
      if (valores.length === 0) return '';
      return '<select id="' + id + '" aria-label="Filtrar por ' + rotulo.toLowerCase() + '">' +
        '<option value="">' + rotulo + ' (todos)</option>' +
        valores.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('') +
        '</select>';
    }
    const selects = selectFiltro('orgao', 'ed-f-orgao', 'Órgão') +
      selectFiltro('cargo', 'ed-f-cargo', 'Cargo') +
      selectFiltro('estado', 'ed-f-estado', 'Estado');
    const m = abrirModal(
      '<h3>Editais disponíveis</h3>' +
      '<p class="sub">Escolha um edital e o sistema gera um plano de estudos personalizado para você.</p>' +
      '<div class="editais-filtros">' +
      '<input type="search" id="ed-f-busca" placeholder="Pesquisa geral (nome, banca…)" aria-label="Pesquisa geral" value="' + esc(filtro.busca) + '">' +
      (selects ? '<div class="editais-filtros-selects">' + selects + '</div>' : '') +
      '<button type="button" class="botao" id="ed-criar-plano" disabled>Criar plano</button>' +
      '</div>' +
      '<div class="editais-lista" id="ed-lista">' + editaisListaHtml(filtro) + '</div>' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="ed-limpar">Limpar filtros</button>' +
      '<button type="button" class="botao-quieto" id="ed-fechar">Fechar</button></div>'
    );
    m.classList.add('modal-amplo');
    const listaEl = m.querySelector('#ed-lista');
    const btnCriar = m.querySelector('#ed-criar-plano');
    let editavelId = null;
    function ligarSelecao() {
      const pedir = listaEl.querySelector('[data-pedir-edital-modal]');
      if (pedir) pedir.addEventListener('click', function () { abrirPedidoEdital(filtro); });
      listaEl.querySelectorAll('[data-ed-sel]').forEach(function (item) {
        item.addEventListener('click', function () {
          listaEl.querySelectorAll('[data-ed-sel]').forEach(function (i) { i.classList.remove('selecionado'); });
          item.classList.add('selecionado');
          editavelId = item.getAttribute('data-ed-sel');
          btnCriar.disabled = false;
        });
        item.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); }
        });
      });
    }
    function valorSel(sel) { const el = m.querySelector(sel); return el ? el.value : ''; }
    function atualizar() {
      filtro.busca = m.querySelector('#ed-f-busca').value;
      filtro.orgao = valorSel('#ed-f-orgao');
      filtro.cargo = valorSel('#ed-f-cargo');
      filtro.estado = valorSel('#ed-f-estado');
      editavelId = null;
      btnCriar.disabled = true;
      listaEl.innerHTML = editaisListaHtml(filtro);
      ligarSelecao();
    }
    btnCriar.addEventListener('click', function () {
      if (!editavelId) return;
      fecharModal();
      criarPlanoDeEdital(editavelId);
    });
    m.querySelector('#ed-f-busca').addEventListener('input', atualizar);
    ['#ed-f-orgao', '#ed-f-cargo', '#ed-f-estado'].forEach(function (sel) {
      const el = m.querySelector(sel);
      if (el) el.addEventListener('change', atualizar);
    });
    m.querySelector('#ed-limpar').addEventListener('click', function () {
      m.querySelector('#ed-f-busca').value = '';
      ['#ed-f-orgao', '#ed-f-cargo', '#ed-f-estado'].forEach(function (sel) { const el = m.querySelector(sel); if (el) el.value = ''; });
      atualizar();
    });
    m.querySelector('#ed-fechar').addEventListener('click', fecharModal);
    ligarSelecao();
  }

  // Explicação do recálculo: antes era um parágrafo fixo no card (poluía a tela).
  // Agora aparece só sob demanda — ao tocar em "Recalcular" ou no 1º recálculo automático.
  const EXPLICACAO_RECALCULO = 'O plano é recalculado a cada semana: o sistema compara o que você registrou com o que estava previsto e redistribui o que faltou nas semanas seguintes, ajustando o plano à sua realidade.';

  function abrirExplicacaoRecalculo(opcoes) {
    opcoes = opcoes || {};
    const resultado = opcoes.resultado;
    let linhaResultado = '';
    if (resultado === 'auto') {
      linhaResultado = '<p class="dialogo-msg" style="margin-top:0.6rem"><strong>O plano desta semana acabou de ser recalculado</strong> com base no seu progresso real.</p>';
    } else if (resultado && resultado.aplicado) {
      linhaResultado = '<p class="dialogo-msg" style="margin-top:0.6rem">' + (resultado.estendido
        ? '<strong>Término ajustado para ~' + esc(String(resultado.meses).replace('.', ',')) + ' meses</strong> no seu ritmo atual.'
        : '<strong>Plano recalculado</strong> com base no seu progresso real.') + '</p>';
    } else if (resultado && resultado.aplicado === false) {
      linhaResultado = '<p class="dialogo-msg" style="margin-top:0.6rem">Ainda não há o que recalcular — o plano está na primeira semana. A partir da próxima segunda o ajuste passa a valer.</p>';
    }
    const m = abrirModal(
      '<div class="dialogo-icone" aria-hidden="true">↻</div>' +
      '<h3>Recálculo do plano</h3>' +
      '<p class="sub dialogo-msg">' + esc(EXPLICACAO_RECALCULO) + '</p>' +
      linhaResultado +
      '<div class="modal-acoes"><button type="button" id="recalc-ok">Entendi</button></div>'
    );
    m.classList.add('modal-dialogo');
    m.querySelector('#recalc-ok').addEventListener('click', fecharModal);
  }

  // A semana de estudos FECHA no domingo às 21h: a partir daí o check-in e o
  // recálculo já tratam a semana como encerrada, sem esperar a virada de segunda.
  // (App estático: reflete quando o aluno abrir o app no domingo 21h ou depois.)
  const HORA_FECHAMENTO_SEMANA = 21;
  function hojeRefCheckin() {
    const agora = new Date();
    if (agora.getDay() === 0 && agora.getHours() >= HORA_FECHAMENTO_SEMANA) {
      return D.addDias(D.hojeISO(), 1); // domingo após 21h já conta como a próxima semana
    }
    return D.hojeISO();
  }

  // RN10 — cartão de check-in semanal + projeção de conclusão (burn-down do edital)
  // Texto da conclusão estimada. Horizontes longos viram meses/anos (e um teto
  // qualitativo) em vez de um número gigante e inútil tipo "260 semanas".
  function prazoConclusaoTxt(burn) {
    if (burn.situacao === 'concluido' || burn.semanasParaConcluir <= 0) return 'Concluído 🏁';
    const sem = burn.semanasParaConcluir;
    if (sem >= 200) return '4+ anos';                        // ritmo muito baixo
    if (sem >= 78) return '~' + Math.round(sem / 52) + ' anos';
    if (sem >= 26) return '~' + Math.round(sem / 4.345) + ' meses';
    return formatarSemanasDias(sem);
  }

  function checkinSemanalHtml() {
    const burn = D.burndownEdital(state, D.hojeISO());
    if (!burn) return '';
    const check = D.checkinSemanal(state, hojeRefCheckin());
    const mapaSit = {
      no_prazo: { classe: 'ok', rotulo: 'No prazo', icone: '✅' },
      adiantado: { classe: 'ok', rotulo: 'Adiantado', icone: '🚀' },
      atrasado: { classe: 'alerta', rotulo: 'Atrasado', icone: '⚠️' },
      parado: { classe: 'alerta', rotulo: 'Ritmo parado', icone: '⚠️' },
      concluido: { classe: 'ok', rotulo: 'Esforço concluído', icone: '🏁' }
    };
    const sit = mapaSit[burn.situacao] || mapaSit.no_prazo;

    // Números coerentes com o que o aluno vê no calendário:
    // - planejado da semana = horas REALMENTE agendadas nesta semana (não a capacidade bruta);
    // - carga "real" só quando já há estudo registrado, senão mostramos a planejada.
    const inicioSemana = D.segundaDaSemana(hojeRefCheckin());
    const planSemana = horasAgendadasSemana(inicioSemana);
    const feitoSemana = check.atual ? check.atual.realizado : 0;
    const restanteSemana = Math.round(Math.max(0, planSemana - feitoSemana) * 10) / 10;
    // Mostra a carga REAL (e projeta por ela) só quando há amostra representativa;
    // antes disso, exibe a planejada — evita que 1-2 sessões mostrem um ritmo/
    // conclusão irreais (ex.: "260 semanas" após poucos minutos de estudo).
    const temReal = burn.projecaoReal;
    const planoNovoEstaSemana = state.plano.gerado_em && state.plano.gerado_em >= inicioSemana;
    const cargaValor = temReal ? burn.ritmoReal : planSemana;
    const cargaRotulo = temReal ? 'Carga horária real / semana' : 'Carga horária planejada / semana';

    // Prévia da semana corrente — o aluno antecipa, no último dia, se vai fechar.
    // Quando o plano foi gerado nesta semana a linha inline some por completo;
    // a explicação fica no tooltip do card (mantém a tela bem mais limpa).
    let semanaAtualLinha = '';
    if (planSemana > 0 && !planoNovoEstaSemana) {
      const ok = restanteSemana <= 0.1;
      const ehUltimoDia = check.atual && check.atual.ehUltimoDia;
      const apertou = ehUltimoDia && restanteSemana > 8;
      const classe = apertou ? 'alerta' : (ok ? 'ok' : '');
      let msg;
      if (ok) {
        msg = 'meta da semana batida 👏';
      } else if (apertou) {
        msg = 'faltam ' + restanteSemana + 'h e hoje é o último dia da semana — o que não fechar entra no recálculo de segunda.';
      } else if (ehUltimoDia) {
        msg = 'faltam ' + restanteSemana + 'h e hoje é o último dia da semana — dá um gás para fechar.';
      } else {
        msg = 'faltam ' + restanteSemana + 'h para a meta desta semana.';
      }
      semanaAtualLinha = '<div class="checkin-comparativo ' + classe + '">' +
        '<span>Esta semana · planejado <strong>' + planSemana + 'h</strong>' +
        ' · feito <strong>' + feitoSemana + 'h</strong></span>' +
        '<span class="checkin-saldo">' + msg + '</span></div>';
    }

    let checkLinha = '';
    if (check.temDados) {
      const deficit = check.saldo < -0.1;
      const superavit = check.saldo > 0.1;
      checkLinha = '<div class="checkin-comparativo ' + (deficit ? 'alerta' : 'ok') + '">' +
        '<span>Semana passada · planejado <strong>' + formatarHorasSemana(check.planejado).replace(' na semana', '') + '</strong>' +
        ' · realizado <strong>' + check.realizado + 'h</strong></span>' +
        '<span class="checkin-saldo">' + (deficit
          ? 'déficit de ' + Math.abs(check.saldo) + 'h — redistribuído nas semanas restantes'
          : superavit
            ? 'superávit de ' + check.saldo + 'h — carga futura aliviada'
            : 'na meta 👏') + '</span></div>';
    }
    const dicaCard = planoNovoEstaSemana
      ? 'Plano recém-gerado: a semana atual já está toda planejada na agenda. O acompanhamento (e o recálculo automático) começa na próxima segunda.'
      : '';
    return '<div class="card checkin-card checkin-' + sit.classe + '"' + (dicaCard ? ' title="' + esc(dicaCard) + '"' : '') + '>' +
      '<div class="checkin-head"><div class="card-kpi-rotulo">Check-in semanal</div>' +
      '<span class="checkin-badge checkin-badge-' + sit.classe + '">' + sit.icone + ' ' + sit.rotulo + '</span></div>' +
      '<div class="checkin-grid checkin-grid-2">' +
      '<div class="checkin-kpi"><span class="checkin-num">' + cargaValor + 'h</span>' +
      '<span class="checkin-rotulo">' + cargaRotulo + '</span></div>' +
      '<div class="checkin-kpi"><span class="checkin-num checkin-num-prazo" title="Projeção pelo seu ritmo real: aumenta se você atrasa, diminui se adianta tópicos.">' +
      esc(prazoConclusaoTxt(burn)) + '</span>' +
      '<span class="checkin-rotulo">Conclusão estimada (ajusta ao seu ritmo)</span></div></div>' +
      semanaAtualLinha +
      checkLinha +
      // O recálculo é AUTOMÁTICO, uma vez por semana (virada de domingo→segunda à
      // meia-noite). O botão manual foi removido: recálculos no meio da semana
      // sob demanda causavam sobrecarga/regeneração acidental do dia.
      '<p class="sub checkin-recalc-nota">↻ O plano se recalcula sozinho toda semana, na virada de domingo, com base no seu progresso.</p>' +
      '</div>';
  }

  function abrirConfiguracoesPlanejamento() {
    const risco = state.plano ? '<div class="card planejamento-card plano-risco"><div class="card-kpi-rotulo">Zona de risco</div>' +
      '<h3>Excluir plano atual</h3>' +
      '<p class="sub">Remove o plano ativo e limpa sessões, revisões, simulados e blocos da agenda vinculados a ele.</p>' +
      '<div class="compact-actions"><button class="botao-mini botao-perigo" id="cfg-excluir-plano">Excluir plano atual</button></div></div>' : '';
    const m = abrirModal(
      '<h3>Configurações do planejamento</h3>' +
      '<p class="sub">Os planos nascem dos editais disponíveis na tela de Planejamento. Aqui você cria um plano manual ou remove o atual.</p>' +
      '<div class="planejamento-config-panel modal-config-panel">' +
      '<div class="card planejamento-card"><div class="card-kpi-rotulo">Plano manual</div>' +
      '<h3>Estudos livres</h3>' +
      '<p class="sub">Crie um plano vazio para organizar disciplinas próprias, sem edital.</p>' +
      '<div class="compact-actions"><button class="botao-mini botao-secundario" id="pl-em-branco-2">Criar plano manual</button></div></div>' +
      risco +
      '</div>' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="cfg-fechar">Fechar</button></div>'
    );
    m.classList.add('modal-amplo');
    m.querySelector('#cfg-fechar').addEventListener('click', fecharModal);
    const emBranco = m.querySelector('#pl-em-branco-2');
    if (emBranco) emBranco.addEventListener('click', function () { fecharModal(); criarPlanoManualComPrompt(); });
    const excluir = m.querySelector('#cfg-excluir-plano');
    if (excluir) excluir.addEventListener('click', async function () {
      const id = state.planoAtivoId;
      if (id && await excluirPlano(id, true)) fecharModal();
    });
  }

  function criarPlanoManual(nome) {
    const titulo = (nome || 'Meus estudos').trim();
    state.planos.push({
      id: window.Store.novoId('pln'), criadoEm: D.hojeISO(),
      plano: { concurso: titulo, banca: '', cota: null, meta: { corte_pct: 70 }, radar: null, ritmos: null, ritmoAtivo: 'sustentavel', gerado_em: null },
      disciplinas: [], cronogramas: { sustentavel: [], hardcore: [] }, links: []
    });
    window.Store.ativarPlano(state, state.planos[state.planos.length - 1].id);
    if (state.config) delete state.config.apagadoEm;
    salvar();
  }

  async function criarPlanoManualComPrompt() {
    if (await limitePlanoBloqueia()) return;
    pedirTexto({ titulo: 'Novo plano manual', mensagem: 'Dê um nome para o plano.', placeholder: 'Ex.: INSS 2027, Estudos livres', valor: 'Meus estudos', confirmar: 'Criar plano' }).then(function (nome) {
      if (!nome) return;
      criarPlanoManual(nome);
      render();
      toast('Plano "' + nome.trim() + '" criado', 'sucesso');
    });
  }

  function pertenceAoPlano(item, planoId) {
    return item && (item.planoId === planoId || (!item.planoId && state.planoAtivoId === planoId));
  }

  const LISTAS_COM_PLANO = ['sessoes', 'revisoes', 'simulados', 'agenda', 'flashcards'];

  function planoExiste(planoId) {
    return state.planos.some(function (p) { return p && p.id === planoId; });
  }

  // Registros de estudo que apontam para um plano que não existe mais (excluído
  // aqui ou em outro aparelho). Eles seguem no estado, mas nenhuma tela os mostra.
  function registrosOrfaos() {
    let total = 0;
    LISTAS_COM_PLANO.forEach(function (k) {
      (state[k] || []).forEach(function (item) {
        if (item && item.planoId && !planoExiste(item.planoId)) total++;
      });
    });
    return { total };
  }

  // Editais-artefato de plano combinado (ocultos do catálogo) cujo plano foi
  // excluído: servem de base para recriar o plano com os MESMOS ids de
  // disciplinas/tópicos, o que faz sessões e simulados órfãos voltarem a casar.
  function editaisCombinadosSemPlano() {
    return (state.editais || []).filter(function (e) {
      if (!e || !e.ocultoNoCatalogo) return false;
      return !state.planos.some(function (p) { return p && p.plano && p.plano.origemEditalId === e.id; });
    });
  }

  // ---------- Backups diários na nuvem (ver firebase-sync.js) ----------
  async function abrirBackupsNuvem() {
    if (!window.FirebaseSync || !window.FirebaseSync.ativo()) {
      toast('Entre com Google para ver os backups na nuvem.', 'erro');
      return;
    }
    let lista;
    try { lista = await window.FirebaseSync.listarBackupsNuvem(); }
    catch (e) { toast('Não consegui listar os backups: ' + (e && e.message ? e.message : e), 'erro'); return; }
    if (!lista.length) {
      abrirModal('<h3>Backups na nuvem</h3><p class="sub">Ainda não há backups. Um snapshot dos seus dados é guardado automaticamente uma vez por dia (últimos 7 dias) a cada sincronização.</p>' +
        '<div class="modal-acoes"><button type="button" id="bk-fechar">Fechar</button></div>')
        .querySelector('#bk-fechar').addEventListener('click', fecharModal);
      return;
    }
    let html = '<h3>Backups na nuvem</h3><p class="sub">Um snapshot por dia, últimos 7 dias. Restaurar usa o backup como base e <strong>mantém</strong> os registros feitos depois dele (nada de hoje se perde).</p>';
    lista.forEach(function (b) {
      const quando = b.criadoEm ? b.criadoEm.slice(0, 10).split('-').reverse().join('/') + ' ' + b.criadoEm.slice(11, 16) : b.id;
      html += '<div class="modal-acoes" style="justify-content:space-between;margin-bottom:0.35rem">' +
        '<span class="sub">' + esc(quando) + ' · ' + b.planos + ' plano(s) · ' + b.registros + ' registro(s)</span>' +
        '<button type="button" class="botao-secundario botao-mini" data-bk="' + esc(b.id) + '">Restaurar</button></div>';
    });
    html += '<div class="modal-acoes"><button type="button" class="botao-quieto" id="bk-fechar">Fechar</button></div>';
    const m = abrirModal(html);
    m.querySelector('#bk-fechar').addEventListener('click', fecharModal);
    m.querySelectorAll('[data-bk]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        const ok = await confirmar({
          titulo: 'Restaurar backup?',
          mensagem: 'O estado do backup vira a base (planos e configurações daquele dia). Sessões, simulados e revisões registrados depois dele são mantidos.',
          confirmar: 'Restaurar', icone: '☁️'
        });
        if (!ok) return;
        try {
          const backup = await window.FirebaseSync.lerBackupNuvem(btn.getAttribute('data-bk'));
          // Restauração explícita anistia as lápides do que o backup traz de
          // volta — sem isso, um plano/sessão excluído depois do backup seria
          // filtrado de novo pela própria mescla.
          const idsBackup = {};
          (backup.planos || []).forEach(function (p) { if (p && p.id) idsBackup[p.id] = true; });
          ['sessoes', 'revisoes', 'simulados', 'flashcards'].forEach(function (k) {
            (backup[k] || []).forEach(function (r) { if (r && r.id) idsBackup[r.id] = true; });
          });
          [state.config, backup.config].forEach(function (cfg) {
            if (!cfg) return;
            if (cfg.planosExcluidos) Object.keys(cfg.planosExcluidos).forEach(function (id) { if (idsBackup[id]) delete cfg.planosExcluidos[id]; });
            if (Array.isArray(cfg.removidos)) cfg.removidos = cfg.removidos.filter(function (id) { return !idsBackup[id]; });
          });
          if (window.Store.limparLapidesDeEntidadesPresentes) {
            window.Store.limparLapidesDeEntidadesPresentes(state, backup);
          }
          // A escolha explícita do usuário vence a regra "versão mais editada
          // por plano": sem este carimbo, a versão ATUAL do plano (a que
          // motivou o restore) ganharia da versão do backup na mescla.
          const agoraRestore = new Date().toISOString();
          (backup.planos || []).forEach(function (p) {
            if (!p) return;
            p.atualizadoEm = agoraRestore;
            p.estruturaAtualizadaEm = agoraRestore;
            p.estruturaRev = (parseInt(p.estruturaRev, 10) || 0) + 1;
          });
          state = window.Store.mesclarEstados(backup, state);
          window.Store.salvar(state);
          if (window.FirebaseSync) window.FirebaseSync.agendarEnvio(state);
          fecharModal(); render();
          toast('Backup restaurado', 'sucesso');
        } catch (e) {
          toast('Falha ao restaurar: ' + (e && e.message ? e.message : e), 'erro');
        }
      });
    });
  }

  function vincularOrfaosAoPlanoAtivo() {
    if (!state.planoAtivoId) return 0;
    let n = 0;
    LISTAS_COM_PLANO.forEach(function (k) {
      (state[k] || []).forEach(function (item) {
        if (item && item.planoId && !planoExiste(item.planoId)) { item.planoId = state.planoAtivoId; n++; }
      });
    });
    if (n > 0) salvar();
    return n;
  }

  // Remove sessões, revisões, simulados e blocos de agenda vinculados a um plano.
  // Precisa rodar ENQUANTO o plano ainda é o ativo (pertenceAoPlano usa planoAtivoId
  // como fallback para itens antigos sem planoId), portanto chame antes de removê-lo.
  function limparDadosVinculados(planoId) {
    // Limpa o que é do plano/calendário (revisões agendadas, blocos da agenda e
    // flashcards), mas PRESERVA as estatísticas do aluno: sessões registradas
    // (questões feitas/acertos) e simulados continuam guardados.
    const removidos = state.revisoes.filter(function (r) { return pertenceAoPlano(r, planoId); })
      .concat(state.flashcards.filter(function (f) { return pertenceAoPlano(f, planoId); }));
    window.Store.marcarRemovido(state, removidos.map(function (item) { return item.id; }));
    state.revisoes = state.revisoes.filter(function (r) { return !pertenceAoPlano(r, planoId); });
    state.agenda = state.agenda.filter(function (a) { return !pertenceAoPlano(a, planoId); });
    state.flashcards = state.flashcards.filter(function (f) { return !pertenceAoPlano(f, planoId); });
  }

  function limparAgendaGeradaPlano(planoId) {
    state.agenda = state.agenda.filter(function (a) {
      return !(a.gerado && pertenceAoPlano(a, planoId || state.planoAtivoId));
    });
    if (state.config && Array.isArray(state.config.blocosVinculados)) {
      state.config.blocosVinculados = [];
    }
  }

  function limparCronogramasPlanoAtivo() {
    const entrada = entradaPlanoAtivo();
    if (entrada) entrada.cronogramas = {};
    state.cronogramas = entrada ? entrada.cronogramas : {};
  }

  async function excluirPlano(planoId, limparHistorico) {
    const p = state.planos.find(function (x) { return x.id === planoId; });
    if (!p) return false;
    const msg = limparHistorico
      ? 'O plano "' + p.plano.concurso + '" e o calendário dele serão excluídos. Suas estatísticas de questões e simulados ficam guardadas.'
      : 'O plano "' + p.plano.concurso + '" será excluído. As sessões registradas nele ficam guardadas, mas deixam de aparecer.';
    if (!(await confirmar({ titulo: 'Excluir plano?', mensagem: msg, confirmar: 'Excluir', perigo: true, icone: '🗑️' }))) return false;
    const calendar = limparHistorico ? await excluirEventosPlanoGoogleCalendar(planoId) : { removidos: 0, pendentes: 0 };
    if (limparHistorico) limparDadosVinculados(planoId);
    window.Store.removerPlano(state, planoId);
    // Cronômetro em aberto do plano que acabou de sair: sem tópico/plano onde
    // registrar o tempo, ele viraria uma sessão pausada fantasma.
    const timerDescartado = sanearTimerOrfao({ forcar: true, silencioso: true });
    // Lápide da exclusão: impede que um aparelho com cópia local antiga
    // ressuscite este plano na próxima mescla (ver Store.mesclarEstados).
    if (!state.config.planosExcluidos || typeof state.config.planosExcluidos !== 'object') state.config.planosExcluidos = {};
    state.config.planosExcluidos[planoId] = new Date().toISOString();
    // Sem nenhum plano restante, marca a exclusão para que a nuvem não
    // ressuscite o plano apagado no próximo sync (ver firebase-sync.js).
    if (state.planos.length === 0) state.config.apagadoEm = new Date().toISOString();
    editalAbertas = new Set();
    salvar();
    // Excluir um plano não deve disparar o recálculo semanal do plano que sobrou
    // (evita o toast "Plano da semana recalculado" surgindo junto do "Plano excluído").
    pulaRecalcSemanal = true;
    render();
    pulaRecalcSemanal = false;
    toast('Plano excluído' + (limparHistorico ? ' com os dados vinculados' : '') +
      (calendar.removidos ? ' e Calendar limpo' : '') +
      (timerDescartado ? ' · cronômetro em aberto descartado' : '') +
      (calendar.pendentes ? ' · Calendar pendente de autorizacao' : ''), calendar.pendentes ? 'erro' : 'sucesso');
    return true;
  }

  function grupoCognitivoDisciplina(d) {
    const nome = (d.nome + ' ' + d.id).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (/portugues|lingua|redacao|texto|gramatica/.test(nome)) return 'linguagem';
    if (/raciocinio|logico|matematica|estatistica|financeira|exatas/.test(nome)) return 'logica';
    if (/direito|constitucional|administrativo|civil|penal|tributario|previdenciario|processual/.test(nome)) return 'direito';
    if (/informatica|tecnologia|dados|sistemas/.test(nome)) return 'tecnologia';
    return 'geral';
  }

  // Recebe os docs já ordenados por importância (score) e devolve a ORDEM DE INÍCIO
  // com as dificuldades espalhadas: rodízio difícil → normal → fácil. Dentro de cada
  // dificuldade preserva a ordem de importância. Garante que as primeiras semanas
  // já intercalem matérias difíceis com fáceis/normais (motivação no começo) sem
  // atrasar as difíceis, que entram logo na primeira rodada.
  function espalharPorDificuldade(docsOrdenados) {
    const filas = { dificil: [], media: [], facil: [] };
    docsOrdenados.forEach(function (d) { (filas[d.dif] || filas.media).push(d); });
    const ordem = [];
    const sequencia = [filas.dificil, filas.media, filas.facil];
    while (sequencia.some(function (f) { return f.length; })) {
      sequencia.forEach(function (f) { if (f.length) ordem.push(f.shift()); });
    }
    return ordem;
  }

  // Escolhe até `limite` disciplinas variando o grupo cognitivo (linguagem/lógica/
  // direito/...) para a semana não ser monótona. Com `alternarDif`, no início do
  // plano também evita emendar duas matérias "difíceis", intercalando com as
  // fáceis/normais — assim o aluno sente progresso e não desanima.
  function alternarGrupos(lista, limite, alternarDif) {
    const pool = lista.slice();
    const escolhidos = [];
    let ultimoGrupo = '', ultimaDif = '';
    while (pool.length > 0 && escolhidos.length < limite) {
      let idx = -1;
      if (alternarDif) {
        // ideal: muda grupo E dificuldade ao mesmo tempo
        idx = pool.findIndex(function (x) { return x.grupo !== ultimoGrupo && (x.dif || 'media') !== ultimaDif; });
      }
      if (idx < 0) idx = pool.findIndex(function (x) { return x.grupo !== ultimoGrupo; });
      if (idx < 0 && alternarDif) idx = pool.findIndex(function (x) { return (x.dif || 'media') !== ultimaDif; });
      if (idx < 0) idx = 0;
      const item = pool.splice(idx, 1)[0];
      escolhidos.push(item);
      ultimoGrupo = item.grupo;
      ultimaDif = item.dif || 'media';
    }
    return escolhidos;
  }

  // Parte 3 — macro-planos de estudo
  // Ritmos qualitativos definidos por INTENSIDADE (horas/semana típicas). O prazo
  // em meses é DERIVADO do tamanho do edital (esforço total), não fixo — assim um
  // edital enxuto fecha em menos meses e um grande (ex.: Receita) em mais, no mesmo
  // ritmo. Acelerado é mais intenso → menos meses que Equilibrado, que é < base.
  const RITMOS_PLANO = [
    { nome: 'Acelerado', dica: 'reta final / pós-edital', hSemana: 28 },
    { nome: 'Equilibrado', dica: 'ritmo regular', hSemana: 18 },
    { nome: 'Sustentável', dica: 'pré-edital', hSemana: 12 }
  ];

  // Esforço total estimado do edital (horas), com folga p/ questões/revisão.
  function esforcoEditalHoras(entrada) {
    return totalHorasEstimadasPlano(entrada) * 1.8;
  }

  // Semanas estimadas p/ concluir o edital num dado ritmo (h/semana). Float, com
  // piso baixo (1 semana) só p/ evitar zero — preserva a ordem entre os ritmos.
  function semanasEstimadasRitmo(entrada, hSemana) {
    const esforco = esforcoEditalHoras(entrada);
    if (!esforco) return 26; // sem disciplinas ainda: fallback ~6 meses
    return Math.max(1, esforco / Math.max(4, hSemana));
  }

  // Meses estimados (float) — derivado das semanas, sem piso/arredondamento que
  // achatariam ritmos diferentes num mesmo número.
  function mesesEstimadosRitmo(entrada, hSemana) {
    return semanasEstimadasRitmo(entrada, hSemana) / 4.345;
  }

  // Exibição adaptativa: semanas p/ prazos curtos, meses p/ longos.
  function formatarEstimativaPrazo(semanas) {
    if (semanas < 8.5) {
      const s = Math.max(1, Math.round(semanas));
      return '~' + plural(s, 'semana', 'semanas');
    }
    const m = Math.max(1, Math.round(semanas / 4.345));
    return '~' + plural(m, 'mês', 'meses');
  }

  // Lista de ritmos já com semanas/meses estimados para o edital ativo.
  function ritmosEstimados(entrada) {
    return RITMOS_PLANO.map(function (r) {
      const semanas = semanasEstimadasRitmo(entrada, r.hSemana);
      return { nome: r.nome, dica: r.dica, hSemana: r.hSemana, semanas: semanas, meses: semanas / 4.345 };
    });
  }

  // Dado um nº de meses, devolve o nome do ritmo mais próximo (p/ rótulos).
  function nomeRitmoPorMeses(entrada, meses) {
    const lista = ritmosEstimados(entrada);
    let best = lista[1] || lista[0];
    let melhorDist = Infinity;
    lista.forEach(function (r) {
      const d = Math.abs(r.meses - (meses || 0));
      if (d < melhorDist) { melhorDist = d; best = r; }
    });
    return best ? best.nome : 'Equilibrado';
  }

  const NIVEIS_DIF = [
    { id: 'facil', rotulo: 'Tranquila', dica: 'Já domino, preciso de menos tempo.' },
    { id: 'media', rotulo: 'Normal', dica: 'Tempo equilibrado.' },
    { id: 'dificil', rotulo: 'Difícil', dica: 'Tenho dificuldade, preciso de mais tempo.' }
  ];
  function rotuloDif(k) {
    const n = NIVEIS_DIF.find(function (x) { return x.id === k; });
    return n ? n.rotulo : 'Normal';
  }

  // Ponto de partida (Fase 1): o quanto o aluno já sabe de CADA tópico. A verdade
  // mora no tópico, não na disciplina (cada concurso recorta tópicos diferentes).
  // Default conservador "novo" para nunca superestimar.
  const NIVEIS_CONH = [
    { id: 'novo', rotulo: 'Nunca vi' },
    { id: 'estudei', rotulo: 'Já estudei' },
    { id: 'domino', rotulo: 'Já domino' }
  ];
  // Aceita o TÓPICO (lê a flag de bagagem) ou, por retrocompat, a string de status.
  // Modelo novo: "já estudei"/"já domino" não viram mais teoria_concluida/dominado
  // (que sumiam da fila); ficam pendentes com t.bagagem marcando o nível, então a
  // origem do nível precisa vir da bagagem.
  function nivelConhDoStatus(t) {
    if (t && typeof t === 'object') {
      if (t.bagagem === 'domino') return 'domino';
      if (t.bagagem === 'estudei') return 'estudei';
      return nivelConhDoStatus(t.status);
    }
    if (t === 'dominado') return 'domino';
    if (t === 'teoria_concluida') return 'estudei';
    return 'novo';
  }
  // No modelo novo, "já estudei" e "já domino" voltam para a fila (status pendente)
  // para uma 1ª passada guiada pela plataforma — a curva de revisão só nasce desse
  // estudo real, nunca de uma data-base inventada. O nível fica em t.bagagem (ver
  // aplicação no wizard), usado para deprioridade e para reduzir o esforço estimado.
  function statusDoNivelConh(n, statusAtual) {
    if (n === 'estudei' || n === 'domino') return 'pendente';
    // "novo": só rebaixa quem estava concluído; não mexe em em_curso/pendente
    return (statusAtual === 'teoria_concluida' || statusAtual === 'dominado') ? 'pendente' : (statusAtual || 'pendente');
  }

  function semanasPorMeses(meses) {
    if (meses === 3) return 13;
    if (meses === 6) return 26;
    if (meses === 9) return 39;
    // prazos não-padrão (ex.: plano estendido pelo recálculo) viram semanas de
    // forma proporcional, em vez de cair silenciosamente em 26 (6 meses).
    return Math.max(1, Math.round((Number(meses) || 6) * 4.345));
  }

  function entradaPlanoAtivo() {
    return state.planos.find(function (p) { return p.id === state.planoAtivoId; }) || null;
  }

  function totalHorasEstimadasPlano(entrada) {
    if (!entrada || !entrada.disciplinas) return 0;
    return entrada.disciplinas.reduce(function (n, d) {
      return n + (d.topicos || []).reduce(function (m, t) { return m + (t.horas_estimadas || 2); }, 0);
    }, 0);
  }

  function horasIdeaisSemanaPlano(entrada, meses) {
    const semanas = semanasPorMeses(meses);
    const ideal = Math.ceil((totalHorasEstimadasPlano(entrada) * 1.8) / semanas);
    return Math.max(4, ideal || 20);
  }

  function formatarHorasSemana(horas) {
    const valor = Math.round(horas * 10) / 10;
    return (Number.isInteger(valor) ? String(valor) : String(valor).replace('.', ',')) + 'h na semana';
  }

  // Gera o cronograma hierárquico. opcoes:
  //   horasSemana, ordemAtaque ('edital'|'incidencia')
  //   inicio        — segunda-feira da semana 1 (default: semana corrente)
  //   semanaBase    — deslocamento na numeração das semanas (recálculo adaptativo)
  //   concluidos    — Set de ids de tópicos já vencidos: saem da teoria e entram
  //                   em manutenção/questões (Regra 4 + antecipação da Parte 3)
  //   relatorio     — objeto preenchido com {teoriaTotal, teoriaAgendada} para
  //                   o chamador detectar se a teoria coube no prazo
  function gerarCronogramaHierarquico(disciplinas, semanas, opcoes) {
    opcoes = opcoes || {};
    disciplinas = (disciplinas || []).filter(function (d) {
      return d && (d.id === 'ORF' || D.disciplinaAtivaPlanejamento(d));
    });
    const horasSemana = opcoes.horasSemana || 20;
    const porIncidencia = opcoes.ordemAtaque === 'incidencia'; // Regra 2 — 80/20
    const inicio = opcoes.inicio || D.segundaDaSemana(D.hojeISO());
    const semanaBase = opcoes.semanaBase || 0;
    const concluidos = opcoes.concluidos || null;
    const relatorio = opcoes.relatorio || {};
    const semanasCron = [];
    for (let i = 0; i < semanas; i++) {
      semanasCron.push({ semana: semanaBase + i + 1, inicio: D.addDias(inicio, i * 7), blocos: [], marcos: [] });
    }
    // Horizonte do edital = maior semana_sugerida presente (não mais o 28 fixo de
    // quando os períodos eram padronizados). semana_sugerida é remapeada desse
    // horizonte para o nº real de semanas do plano, preservando a ordem relativa
    // mesmo que o autor do edital tenha usado outra escala.
    let horizonteEdital = 0;
    disciplinas.forEach(function (d) {
      if (d.id === 'ORF') return;
      (d.topicos || []).forEach(function (t) {
        if (!t.orfao && t.semana_sugerida) horizonteEdital = Math.max(horizonteEdital, t.semana_sugerida);
      });
    });
    if (horizonteEdital <= 0) horizonteEdital = 28; // sem semana_sugerida no edital
    // tópicos já concluídos antes deste cálculo → modo manutenção (Regra 4)
    const manutencao = [];
    let teoriaTotal = 0, teoriaAgendada = 0;
    const docs = disciplinas.filter(function (d) { return d.id !== 'ORF'; }).map(function (d, idx) {
      const naoOrfaos = d.topicos.filter(function (t) { return !t.orfao; });
      if (concluidos) {
        naoOrfaos.forEach(function (t) {
          if (concluidos.has(t.id)) manutencao.push({ disciplina: d.id, topico: t.id, inc: t.incidencia_pct || 0 });
        });
      }
      const topicos = naoOrfaos.filter(function (t) {
        return !(concluidos && concluidos.has(t.id));
      }).map(function (t, ordem) {
        const sugerida = t.semana_sugerida ? Math.max(1, Math.min(semanas, Math.round((t.semana_sugerida / horizonteEdital) * semanas))) : ordem + 1;
        return { topico: t, ordem, sugerida };
      });
      // Disciplina que o aluno NUNCA VIU (todos os tópicos a estudar ainda
      // "pendente", sem reabertura) segue a ORDEM DO EDITAL mesmo com 80/20
      // selecionado: começar a base por incidência embaralha o que precisa ser
      // visto em sequência. O 80/20 só vale onde já há contato prévio.
      const disciplinaNuncaVista = topicos.length > 0 && topicos.every(function (x) {
        return x.topico.status === 'pendente' && !x.topico.reaberto;
      });
      const usarIncidencia = porIncidencia && !disciplinaNuncaVista;
      topicos.sort(function (a, b) {
        // Tópicos com bagagem ("já estudei/domino") vão por último: o aluno faz a
        // 1ª passada deles depois dos que nunca viu.
        const bagA = a.topico.bagagem ? 1 : 0;
        const bagB = b.topico.bagagem ? 1 : 0;
        if (bagA !== bagB) return bagA - bagB;
        if (usarIncidencia) {
          // ataca primeiro os tópicos mais cobrados nas provas (regra 80/20)
          return (b.topico.incidencia_pct || 0) - (a.topico.incidencia_pct || 0) ||
            (a.topico.prioridade || 2) - (b.topico.prioridade || 2) || a.sugerida - b.sugerida || a.ordem - b.ordem;
        }
        return a.sugerida - b.sugerida || (a.topico.prioridade || 2) - (b.topico.prioridade || 2) ||
          (b.topico.incidencia_pct || 0) - (a.topico.incidencia_pct || 0) || a.ordem - b.ordem;
      });
      teoriaTotal += topicos.length;
      const incidencia = topicos.reduce(function (n, t) { return n + (t.topico.incidencia_pct || 0); }, 0);
      const prioridade = topicos.reduce(function (n, t) { return n + (4 - (t.topico.prioridade || 2)); }, 0);
      return {
        disciplina: d,
        idx,
        grupo: grupoCognitivoDisciplina(d),
        dif: d.dificuldade || 'media',
        topicos,
        cursor: 0,
        // A dificuldade dá só uma leve dianteira na ORDEM (matéria difícil convém
        // começar cedo p/ ter tempo de maturar), mas sem dominar o início. O ganho
        // real de tempo de uma matéria difícil vem das HORAS por semana
        // (distribuicaoSemanal), não de monopolizar as primeiras semanas. Assim o
        // começo intercala difíceis com fáceis/normais e o aluno colhe vitórias logo.
        score: (d.peso || 1) * 4 * multDificuldadeOrdem(d) + incidencia / 20 + prioridade / Math.max(1, topicos.length),
        inicio: 1
      };
    }).filter(function (d) { return d.topicos.length > 0; }).sort(function (a, b) {
      return b.score - a.score || a.idx - b.idx;
    });
    // A SEMANA DE INÍCIO segue um rodízio de dificuldade (difícil → normal → fácil
    // → difícil ...), não o score puro. Sem isso, com pesos/incidências parecidos,
    // as matérias difíceis ocupariam sozinhas as primeiras semanas e o aluno
    // começaria o plano só apanhando. Assim a largada já mistura difícil com
    // fácil/normal — vitórias rápidas no começo, sem perder o foco no que é pesado.
    espalharPorDificuldade(docs).forEach(function (d, idx) {
      d.inicio = idx < 3 ? 1 : Math.min(semanas, 2 + Math.floor((idx - 2) * semanas / Math.max(1, docs.length)));
    });
    // Vazão de teoria por semana proporcional às HORAS, não só ao nº de disciplinas.
    // Sem isso, a vazão ficava travada em ~limite tópicos/semana (3–6) mesmo com
    // muitas horas: planos longos demais ou edital descoberto. Esforço por tópico ≈
    // horas_estimadas × 1.8 (teoria + questões + revisões), coerente com o cálculo
    // de esforço/semanas. O nº de disciplinas (limite) segue controlando a LARGURA
    // (frentes simultâneas); o orçamento controla a PROFUNDIDADE (tópicos/frente).
    // Disciplinas com a TEORIA 100% concluída entram na FASE DE QUESTÕES sólidas:
    // além das revisões espaçadas (manutenção), a matéria vencida passa a receber
    // cards sólidos de "questões" toda semana — priorizando os tópicos de maior
    // incidência e de pior desempenho —, em paralelo às matérias ainda em teoria.
    const praticaDocs = [];
    if (concluidos) {
      const sessPratica = (typeof state !== 'undefined' && state) ? D.sessoesDoPlano(state) : [];
      disciplinas.filter(function (d) { return d.id !== 'ORF'; }).forEach(function (d, idx) {
        const naoOrfaos = d.topicos.filter(function (t) { return !t.orfao; });
        if (naoOrfaos.length === 0) return;
        if (!naoOrfaos.every(function (t) { return concluidos.has(t.id); })) return;
        const tops = naoOrfaos.map(function (t) {
          const dt = D.desempenhoTopico(sessPratica, t.id);
          const pct = dt.pct == null ? 60 : dt.pct; // sem histórico ainda: desempenho neutro
          const fraqueza = Math.max(0, 100 - pct);   // pior desempenho => mais prioridade
          return { topico: t, peso: 1 + (t.incidencia_pct || 0) / 10 + fraqueza / 25, usos: 0 };
        });
        praticaDocs.push({ disciplina: d, idx: idx, tops: tops });
      });
    }
    let somaHorasTop = 0, nTop = 0;
    docs.forEach(function (d) { d.topicos.forEach(function (x) { somaHorasTop += (x.topico.horas_estimadas || 2); nTop++; }); });
    const avgHorasTop = nTop > 0 ? somaHorasTop / nTop : 2;
    const orcamentoTopSemana = Math.max(1, Math.min(30, Math.round(horasSemana / (1.8 * Math.max(0.5, avgHorasTop)))));
    for (let s = 1; s <= semanas; s++) {
      let ativos = docs.filter(function (d) { return d.inicio <= s && d.cursor < d.topicos.length; });
      if (ativos.length < 3) {
        ativos = ativos.concat(docs.filter(function (d) { return d.inicio > s && d.cursor < d.topicos.length; }).slice(0, 3 - ativos.length));
      }
      ativos.sort(function (a, b) {
        const atrasoA = a.topicos[a.cursor] ? Math.max(0, s - a.topicos[a.cursor].sugerida) : 0;
        const atrasoB = b.topicos[b.cursor] ? Math.max(0, s - b.topicos[b.cursor].sugerida) : 0;
        return (b.score + atrasoB) - (a.score + atrasoA);
      });
      const limiteMax = Math.max(3, Math.min(6, Math.round(horasSemana / 4)));
      const passoRampa = Math.max(3, Math.round(semanas / Math.max(1, docs.length)));
      const rampa = Math.min(limiteMax, 3 + Math.floor((s - 1) / passoRampa));
      const limite = s < semanas * 0.72 ? rampa : Math.min(limiteMax, rampa + 1);
      // No início do plano (primeiros ~40%) também alterna a dificuldade percebida,
      // para cada semana misturar matéria difícil com fácil/normal e não desmotivar.
      const inicioPlano = s <= Math.max(2, Math.round(semanas * 0.4));
      // Frentes da semana (largura) — depois distribui o orçamento de tópicos
      // (profundidade) em rodízio entre elas: com poucas horas, ~1 tópico por
      // frente (comportamento antigo, que vira o piso); com muitas horas, várias
      // passadas, agendando 2+ tópicos por frente sem alargar demais a semana.
      const selecionadas = alternarGrupos(ativos, limite, inicioPlano);
      let restante = Math.max(selecionadas.length, orcamentoTopSemana);
      let progrediu = true;
      while (restante > 0 && progrediu) {
        progrediu = false;
        for (let di = 0; di < selecionadas.length && restante > 0; di++) {
          const d = selecionadas[di];
          const item = d.topicos[d.cursor];
          if (!item) continue;
          d.cursor++;
          restante--;
          progrediu = true;
          const t = item.topico;
          teoriaAgendada++;
          semanasCron[s - 1].blocos.push({ disciplina: d.disciplina.id, topico: t.id, tipo: 'teoria' });
          semanasCron[s - 1].blocos.push({ disciplina: d.disciplina.id, topico: t.id, tipo: 'questoes' });
          if (d.cursor === d.topicos.length) semanasCron[s - 1].marcos.push(d.disciplina.nome + ': primeira passada concluída');
        }
      }
      // Fase de questões das matérias já vencidas: um tópico por disciplina por
      // semana (a agenda realiza um bloco de prática por disciplina/semana), em
      // rodízio que dá mais frequência aos tópicos mais cobrados e de pior
      // desempenho. Roda em TODAS as semanas, em paralelo à teoria das demais.
      praticaDocs.forEach(function (pd) {
        const escolhido = pd.tops.slice().sort(function (a, b) {
          return (b.peso - b.usos) - (a.peso - a.usos);
        })[0];
        if (!escolhido) return;
        escolhido.usos += 1;
        semanasCron[s - 1].blocos.push({ disciplina: pd.disciplina.id, topico: escolhido.topico.id, tipo: 'questoes' });
      });
      // As revisões NÃO entram mais como blocos do cronograma: a fonte única é o
      // sistema de repetição espaçada (state.revisoes), refletido no calendário e
      // que desconta do tempo do dia. Mantemos só o marco de manutenção como aviso.
      if (s === 1 && manutencao.length > 0) {
        semanasCron[0].marcos.push('Manutenção das disciplinas já vencidas (ver Revisões)');
      }
      if (s > Math.round(semanas * 0.78) && s % 3 === 0) {
        semanasCron[s - 1].marcos.push('Simulado e revisão por questões');
      }
    }
    relatorio.teoriaTotal = teoriaTotal;
    relatorio.teoriaAgendada = teoriaAgendada;
    return semanasCron;
  }

  function aplicarPlanoDuracaoAoAtivo(meses, horasSemana, silencioso, ordemAtaque, nomeRitmo, preservarHistorico) {
    const entrada = entradaPlanoAtivo();
    if (!entrada || entrada.disciplinas.length === 0) {
      if (!silencioso) toast('Crie ou importe disciplinas antes de gerar o cronograma.', 'erro');
      return false;
    }
    // meses agora é estimado a partir do edital (não mais fixo em 3/6/9).
    meses = Math.max(1, Math.round(Number(meses) || mesesEstimadosRitmo(entrada, 18)));
    const semanas = semanasPorMeses(meses);
    const chave = 'plano_ativo';
    const hSemana = Math.max(4, Math.round(horasSemana || horasIdeaisSemanaPlano(entrada, meses) || 20));
    if (ordemAtaque) entrada.plano.ordemAtaque = ordemAtaque;
    const ordem = entrada.plano.ordemAtaque || 'edital';
    // tópicos já concluídos/dominados (ex.: vindos do "ponto de partida") saem da
    // teoria e entram em manutenção já na 1ª geração — não só no recálculo.
    const concluidos = new Set();
    entrada.disciplinas.forEach(function (d) {
      if (d.id === 'ORF') return;
      (d.topicos || []).forEach(function (t) {
        if (!t.orfao && (t.status === 'teoria_concluida' || t.status === 'dominado')) concluidos.add(t.id);
      });
    });
    entrada.plano.ritmos = entrada.plano.ritmos || {};
    const relCobertura = {};
    // ATUALIZAÇÃO preservando histórico: ao editar um plano que já rodou algumas
    // semanas (nova carga/prazo), congelamos as semanas PASSADAS (o que já foi
    // estudado) e só refazemos da semana atual em diante — em vez de zerar o
    // calendário inteiro a partir desta segunda, que apagava o histórico. Espelha
    // o recálculo adaptativo semanal.
    const inicioAtual = D.segundaDaSemana(D.hojeISO());
    const cronAntigo = (entrada.cronogramas && entrada.cronogramas[chave]) || [];
    const inicioPlanoAnt = entrada.plano.gerado_em ? D.segundaDaSemana(entrada.plano.gerado_em) : inicioAtual;
    const semanaBase = Math.max(0, Math.round(D.diffDias(inicioPlanoAnt, inicioAtual) / 7));
    const preservar = !!preservarHistorico && cronAntigo.length > 0 && semanaBase > 0;
    const passadas = preservar ? cronAntigo.filter(function (s) { return s.inicio < inicioAtual; }) : [];
    const semanasFuturas = Math.max(1, semanas - semanaBase);
    let cronNovo;
    if (preservar) {
      const futuras = gerarCronogramaHierarquico(entrada.disciplinas, semanasFuturas, {
        horasSemana: hSemana, ordemAtaque: ordem, concluidos: concluidos,
        inicio: inicioAtual, semanaBase: semanaBase, relatorio: relCobertura
      });
      cronNovo = passadas.concat(futuras);
    } else {
      cronNovo = gerarCronogramaHierarquico(entrada.disciplinas, semanas, { horasSemana: hSemana, ordemAtaque: ordem, concluidos: concluidos, relatorio: relCobertura });
    }
    entrada.cronogramas = {};
    entrada.cronogramas[chave] = cronNovo;
    entrada.plano.ritmos = {};
    entrada.plano.ritmos[chave] = { meses: meses, semanas: preservar ? semanaBase + semanasFuturas : semanas, h_semana: hSemana, nomeRitmo: nomeRitmo || nomeRitmoPorMeses(entrada, meses) };
    entrada.plano.ritmoAtivo = chave;
    entrada.plano.modoPlanejamento = 'cronograma';
    entrada.plano.ciclo = { blocos: [], volta: 1 };
    // Âncora do cronograma = segunda da semana atual, igual ao calendário e ao
    // recálculo. Evita divergência de até 6 dias no burndown/projeção de término.
    // Numa atualização preservando histórico mantemos a âncora original para não
    // deslocar as semanas passadas.
    if (!preservar) entrada.plano.gerado_em = inicioAtual;
    entrada.plano.ultimaRecalcSemana = inicioAtual;
    window.Store.hidratar(state);
    // Revisões são a fonte única de "manutenção": tópicos já concluídos/dominados
    // (inclusive vindos do ponto de partida) ganham a curva de repetição espaçada
    // aqui — antes isso vinha de blocos "revisao" do cronograma, agora removidos.
    agendarRevisoesEmLote(Array.from(concluidos)); // retroativo: pula 24h e escalona a base
    if (preservar) {
      // Refaz a agenda da semana atual em diante; as semanas passadas permanecem
      // intactas. IMPORTANTE: se a SEMANA ATUAL já tem progresso (blocos feitos ou
      // parciais — ex.: recálculo ao concluir um tópico no meio do dia), preserva
      // HOJE (e o passado) e recalcula só os dias seguintes: não apaga o que o
      // aluno acabou de estudar nem repete o dia, mas os demais dias se ajustam.
      const hojePreserva = D.hojeISO();
      const preservarAtual = semanaAgendaComProgresso(inicioAtual);
      cronNovo.forEach(function (sem) {
        if (sem.inicio < inicioAtual) return;
        const optsG = (sem.inicio === inicioAtual && preservarAtual) ? { preservarDia: hojePreserva } : undefined;
        gerarBlocosSemanaAgenda(sem.inicio, optsG);
      });
    } else {
      sincronizarAgendaComCronograma(); // o calendário do Planejamento já nasce preenchido
    }
    salvar();
    // Falha A — cobertura: nesse prazo nem toda a teoria do edital coube no
    // cronograma. Em vez de descartar tópicos em silêncio, avisa quanto cobriu e
    // como resolver (a ordenação 80/20 garante que o que MAIS cai entra primeiro).
    // O aviso aparece mesmo em modo silencioso, pois é correção importante.
    const tt = relCobertura.teoriaTotal || 0;
    if (tt > 0 && (relCobertura.teoriaAgendada || 0) < tt) {
      const pct = Math.round((relCobertura.teoriaAgendada / tt) * 100);
      toast('Nesse prazo cabe ~' + pct + '% do edital — ' +
        (ordem === 'incidencia' ? 'aumente as horas/semana ou estenda o prazo.' : 'ataque por incidência (80/20) ou aumente as horas/semana.'), 'erro');
    }
    if (!silencioso) toast('Plano de ' + meses + ' meses gerado e ativado', 'sucesso');
    return true;
  }

  function aplicarPlanosDuracaoAoAtivo(silencioso) {
    return aplicarPlanoDuracaoAoAtivo(6, null, silencioso);
  }

  // ---------- Parte 3 / Regra 6 — Recálculo adaptativo semanal ----------
  // Reconstrói o cronograma das semanas a partir da atual com base no progresso
  // REAL: tópicos já concluídos saem da teoria (a disciplina chega antes à
  // manutenção → antecipação) e os pendentes são redistribuídos nas semanas que
  // faltam. Se a teoria não couber no prazo, estende o prazo e a data de término.
  // As semanas passadas ficam congeladas (histórico); blocos manuais da agenda
  // são preservados. Retorna um resumo do que mudou (ou null se não se aplica).
  // forcar: recalcula mesmo na 1ª semana (ação explícita do usuário, ex.: aluno
  // avançado que marca teoria já concluída e quer o plano refeito na hora).
  function recalcularPlanoAdaptativo(forcar, hojeRef) {
    const entrada = entradaPlanoAtivo();
    if (!entrada || !entrada.plano || !entrada.plano.ritmos) return null;
    const chave = entrada.plano.ritmoAtivo;
    const ritmo = chave && entrada.plano.ritmos[chave];
    if (!ritmo || !ritmo.semanas) return null;

    // hojeRef permite a virada de domingo 21h (semana que fechou já é congelada
    // como histórico). Sem ela, usa o dia real (recálculos sob demanda).
    const hoje = hojeRef || D.hojeISO();
    const inicioPlano = D.segundaDaSemana(entrada.plano.gerado_em || hoje);
    const inicioAtual = D.segundaDaSemana(hoje);
    const semanasDecorridas = Math.max(0, Math.round(D.diffDias(inicioPlano, inicioAtual) / 7));
    if (semanasDecorridas <= 0 && !forcar) return null; // auto-recalc: nada a refazer na 1ª semana
    // Quando forçado na 1ª semana, refaz desde o início do plano (sem semanas congeladas).
    const inicioBase = semanasDecorridas <= 0 ? inicioPlano : inicioAtual;

    entrada.cronogramas = entrada.cronogramas || {};
    const cronAntigo = entrada.cronogramas[chave] || [];
    const passadas = cronAntigo.filter(function (s) { return s.inicio < inicioBase; }); // semanas finalizadas = histórico congelado

    // tópicos já vencidos (teoria concluída ou dominados) — não voltam para a teoria
    const concluidos = new Set();
    entrada.disciplinas.forEach(function (d) {
      if (d.id === 'ORF') return;
      (d.topicos || []).forEach(function (t) {
        if (!t.orfao && (t.status === 'teoria_concluida' || t.status === 'dominado')) concluidos.add(t.id);
      });
    });

    const semanasAlvo = Math.max(1, ritmo.semanas - semanasDecorridas);
    const ordem = entrada.plano.ordemAtaque || 'edital';
    // tenta encaixar toda a teoria pendente; se não couber, estende o prazo
    let semanasUsar = semanasAlvo, futuras, rel, tentativas = 0;
    do {
      rel = {};
      futuras = gerarCronogramaHierarquico(entrada.disciplinas, semanasUsar, {
        horasSemana: ritmo.h_semana, ordemAtaque: ordem,
        inicio: inicioBase, semanaBase: semanasDecorridas, concluidos: concluidos, relatorio: rel
      });
      if (rel.teoriaAgendada >= rel.teoriaTotal) break;
      semanasUsar += 4; tentativas++;
    } while (tentativas < 26);

    const estendido = semanasUsar > semanasAlvo;
    const semanasTotaisNovas = semanasDecorridas + semanasUsar;

    entrada.cronogramas[chave] = passadas.concat(futuras);
    if (estendido) {
      ritmo.semanas = semanasTotaisNovas;
      ritmo.meses = Math.round((semanasTotaisNovas / 4.345) * 10) / 10;
    }
    entrada.plano.ultimaRecalcSemana = inicioAtual;

    window.Store.hidratar(state);
    // Regenera a agenda da semana atual em diante (preserva blocos manuais e o
    // passado). Se a semana ATUAL já tem progresso (ex.: recálculo ao concluir a
    // teoria depois de fechar as horas do dia), preserva HOJE (e o passado) e
    // recalcula SÓ os dias seguintes: o que o aluno estudou hoje continua riscado
    // no seu dia; as disciplinas dos OUTROS dias são recalculadas (o tópico já
    // concluído sai da fila), sem apagar o dia atual nem sobrecarregá-lo.
    const hojeRecalc = D.hojeISO();
    const ontem = D.addDias(hojeRecalc, -1);
    // Regra do passado: na SEMANA ATUAL, dias que já passaram NUNCA são regenerados
    // (não dá para voltar no tempo). E HOJE só é regenerado se ainda não teve estudo
    // nenhum — se o aluno já estudou hoje (sessões OU blocos), o dia é preservado e
    // o recálculo não empilha mais carga nele. Semanas futuras são refeitas normal.
    const preservarDiaAtual = diaTeveEstudo(hojeRecalc) ? hojeRecalc : ontem;
    futuras.forEach(function (sem) {
      const optsG = (sem.inicio === inicioAtual) ? { preservarDia: preservarDiaAtual } : undefined;
      gerarBlocosSemanaAgenda(sem.inicio, optsG);
    });
    salvar();
    return { estendido: estendido, semanasTotais: semanasTotaisNovas, meses: ritmo.meses, semanasDecorridas: semanasDecorridas };
  }

  // dispara o recálculo no máximo uma vez por semana (toda segunda há um plano novo)
  function verificarRecalculoSemanal() {
    const entrada = entradaPlanoAtivo();
    if (!entrada || !entrada.plano || !entrada.plano.ritmos || !entrada.plano.ritmoAtivo) return;
    // Recálculo semanal na virada de MEIA-NOITE (domingo→segunda): usa a data real
    // (D.hojeISO), então roda uma vez por semana quando o app é aberto na segunda
    // em diante — não no meio da semana. É a única forma de recálculo agora (o
    // botão manual foi removido para evitar recálculos acidentais no meio da semana).
    const inicioAtual = D.segundaDaSemana(D.hojeISO());
    if (entrada.plano.ultimaRecalcSemana === inicioAtual) return; // já recalculado nesta semana
    const r = recalcularPlanoAdaptativo(false, D.hojeISO());
    if (!r) {
      // marca a semana mesmo sem recálculo aplicável, para não reavaliar a cada render
      entrada.plano.ultimaRecalcSemana = inicioAtual;
      return;
    }
    // No 1º recálculo automático, explica em um modal central (depois é só toast).
    if (!state.config.explicacaoRecalculoVista) {
      state.config.explicacaoRecalculoVista = true;
      salvar({ sincronizar: false });
      abrirExplicacaoRecalculo({ resultado: 'auto' });
    } else {
      toast(r.estendido
        ? 'Plano recalculado: no seu ritmo o término foi ajustado para ~' + String(r.meses).replace('.', ',') + ' meses.'
        : 'Plano da semana recalculado com base no seu progresso.', r.estendido ? 'erro' : 'sucesso');
    }
  }

  function abrirGerarPlano() {
    if (!state.plano || state.disciplinas.length === 0) {
      toast('Crie ou importe disciplinas antes de gerar o plano.', 'erro');
      return;
    }
    const ritmo = state.plano.ritmoAtivo;
    const atual = state.plano.ritmos && ritmo ? state.plano.ritmos[ritmo] : null;
    const mesesAtual = atual && atual.meses ? atual.meses : 6;
    const horasAtual = atual && atual.h_semana ? atual.h_semana : (D.metaSemanal(state, D.hojeISO()).horasAlvo || 20);
    const m = abrirModal(
      '<h3>Gerar plano de estudos</h3>' +
      '<p class="sub">Escolha uma duração. O sistema mantém apenas um cronograma ativo por plano e organiza as disciplinas de forma gradual.</p>' +
      '<form id="form-gerar-plano">' +
      '<div class="grade-2"><div><label for="gp-meses">Terminar edital em</label><select id="gp-meses">' +
      [3, 6, 9].map(function (v) {
        return '<option value="' + v + '"' + (v === mesesAtual ? ' selected' : '') + '>' + v + ' meses</option>';
      }).join('') + '</select></div>' +
      '<div><label for="gp-horas">Horas por semana</label><input id="gp-horas" type="number" min="4" max="80" value="' + esc(horasAtual) + '"></div></div>' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="gp-cancelar">Cancelar</button>' +
      '<button type="submit">Gerar plano</button></div></form>'
    );
    m.querySelector('#gp-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#form-gerar-plano').addEventListener('submit', function (e) {
      e.preventDefault();
      const meses = parseInt(m.querySelector('#gp-meses').value, 10);
      const horas = Math.max(4, Math.min(80, parseInt(m.querySelector('#gp-horas').value, 10) || 20));
      if (!aplicarPlanoDuracaoAoAtivo(meses, horas, true)) return;
      fecharModal();
      const cron = D.cronogramaAtivo(state);
      agendaRef = modoPlano === 'ciclo' ? D.segundaDaSemana(D.hojeISO()) : (cron.length ? cron[0].inicio : D.segundaDaSemana(D.hojeISO()));
      agendaModo = 'semana';
      render();
      if (modoPlano === 'ciclo') toast('Ciclo de estudos gerado com topicos sugeridos', 'sucesso');
      else
      toast('Plano gerado — o calendário foi preenchido com todas as semanas', 'sucesso');
    });
  }

  function abrirGerarPlanoComRotina(opcoes) {
    opcoes = opcoes || {};
    if (!state.plano || state.disciplinas.length === 0) {
      toast('Crie ou importe disciplinas antes de gerar o plano.', 'erro');
      return;
    }
    const ritmo = state.plano.ritmoAtivo;
    const atual = state.plano.ritmos && ritmo ? state.plano.ritmos[ritmo] : null;
    const ordemAtual = state.plano.ordemAtaque || 'edital';
    const rotina = rotinaEstudosAtual();
    const totalAtual = totalMinutosRotina(rotina);
    const entrada = entradaPlanoAtivo();
    // Edição de um plano que JÁ existe (vs. criar do zero pelo "Iniciar"). Quando
    // verdadeiro, o botão final diz "Atualizar plano" e a regeneração preserva o
    // histórico já estudado em vez de zerar o calendário.
    const ehAtualizacao = !opcoes.novoPlanoId && !!(state.plano.ritmoAtivo ||
      (state.plano.ciclo && state.plano.ciclo.blocos && state.plano.ciclo.blocos.length));
    // Ritmos com meses estimados a partir do tamanho do edital ativo.
    const ritmosCalc = ritmosEstimados(entrada);
    // Seleção inicial: ritmo do plano atual (mais próximo) ou o Equilibrado.
    let ritmoSel = ritmosCalc[1] || ritmosCalc[0];
    if (atual && atual.meses) {
      let melhor = Infinity;
      ritmosCalc.forEach(function (r) { const d = Math.abs(r.meses - atual.meses); if (d < melhor) { melhor = d; ritmoSel = r; } });
    }
    const mesesAtual = ritmoSel ? Math.max(1, Math.round(ritmoSel.meses)) : 6;
    // Janela da prova (se existir) → o passo Prazo segue essa data como base.
    const radarPlano = (state.plano && state.plano.radar) || {};
    const janelaPlano = radarPlano.janela_prova || null;
    const temJanela = !!(janelaPlano && janelaPlano[0]);
    const janelaFim = temJanela ? (janelaPlano[1] || janelaPlano[0]) : '';
    const janelaTexto = temJanela
      ? (D.formatarMesBR(janelaPlano[0]) + (janelaPlano[1] && janelaPlano[1] !== janelaPlano[0] ? ' – ' + D.formatarMesBR(janelaPlano[1]) : ''))
      : '';
    // Quantos meses faltam até um mês AAAA-MM (mínimo 1).
    function mesesAteMes(mes) {
      if (!mes) return mesesAtual;
      const partesH = hojeMesISO().split('-').map(Number);
      const partesA = mes.split('-').map(Number);
      return Math.max(1, (partesA[0] - partesH[0]) * 12 + (partesA[1] - partesH[1]));
    }
    const mesesInicial = temJanela ? mesesAteMes(janelaFim) : mesesAtual;
    const idealAtual = horasIdeaisSemanaPlano(entrada, mesesInicial);
    const optsMin = TEMPOS_BLOCO.map(function (v) {
      return '<option value="' + v + '"' + (v === rotina.minBloco ? ' selected' : '') + '>' + rotuloBloco(v) + '</option>';
    }).join('');
    const optsMax = TEMPOS_BLOCO.map(function (v) {
      return '<option value="' + v + '"' + (v === rotina.maxBloco ? ' selected' : '') + '>' + rotuloBloco(v) + '</option>';
    }).join('');
    const diasHtml = ROTINA_DIAS.map(function (d) {
      const cfg = rotina.dias[d.id] || { ativo: d.ativo, minutos: d.minutos };
      return '<label class="rotina-dia">' +
        '<input type="checkbox" data-rot-ativo="' + d.id + '"' + (cfg.ativo ? ' checked' : '') + '>' +
        '<span class="rotina-dia-badge">' + d.label + '</span>' +
        '<input data-rot-horas="' + d.id + '" type="text" inputmode="numeric" maxlength="5" placeholder="00:00" value="' + formatarHorasDia(cfg.minutos || d.minutos) + '" aria-label="Horas de estudo em ' + d.label + ' (formato HH:MM)">' +
        '</label>';
    }).join('');

    // Passo 3 — Dificuldade por disciplina (alimenta o algoritmo de distribuição de horas).
    const difHtml = state.disciplinas.filter(function (d) { return d.id !== 'ORF'; }).map(function (d) {
      const atual = d.dificuldade || 'media';
      return '<div class="gp-dif-row" data-dif-disc="' + esc(d.id) + '">' +
        '<span class="gp-dif-nome"><span class="tag-disc" style="background:' + esc(d.cor || '#9A9DA3') + '">' + esc(d.id) + '</span>' + esc(nomeDiscCurto(d.nome)) + '</span>' +
        '<div class="gp-dif-opts" role="radiogroup" aria-label="Dificuldade em ' + esc(nomeDiscCurto(d.nome)) + '">' +
        NIVEIS_DIF.map(function (n) {
          return '<button type="button" class="gp-dif-opt gp-dif-' + n.id + (atual === n.id ? ' ativo' : '') + '" data-dif="' + n.id + '" title="' + esc(n.dica) + '">' + esc(n.rotulo) + '</button>';
        }).join('') +
        '</div></div>';
    }).join('');

    // Passo 4 — "O que já sei": diagnóstico por disciplina, detalhável por tópico.
    // Default conservador (lê do status atual): nada é assumido como sabido.
    const ppHtml = state.disciplinas.filter(function (d) { return d.id !== 'ORF'; }).map(function (d) {
      const tops = (d.topicos || []).filter(function (t) { return !t.orfao; });
      const linhas = tops.map(function (t) {
        const atual = nivelConhDoStatus(t);
        return '<div class="gp-pp-top"><span class="gp-pp-top-nome">' + esc(t.nome) + '</span>' +
          '<select class="gp-pp-sel" data-pp-top="' + esc(t.id) + '">' +
          NIVEIS_CONH.map(function (n) { return '<option value="' + n.id + '"' + (atual === n.id ? ' selected' : '') + '>' + n.rotulo + '</option>'; }).join('') +
          '</select></div>';
      }).join('');
      return '<div class="gp-pp-disc" data-pp-disc="' + esc(d.id) + '">' +
        '<button type="button" class="gp-pp-cab" data-pp-toggle>' +
        '<span class="tag-disc" style="background:' + esc(d.cor || '#9A9DA3') + '">' + esc(d.id) + '</span>' +
        '<span class="gp-pp-nome">' + esc(nomeDiscCurto(d.nome)) + '</span>' +
        '<span class="gp-pp-resumo" data-pp-resumo></span><span class="gp-pp-caret">⌄</span></button>' +
        '<div class="gp-pp-corpo oculto">' +
        '<div class="gp-pp-bulk"><span class="gp-pp-bulk-rotulo">Marcar todos</span>' +
        '<div class="gp-pp-bulk-btns">' +
        NIVEIS_CONH.map(function (n) { return '<button type="button" class="botao-mini botao-quieto" data-pp-bulk="' + n.id + '">' + n.rotulo + '</button>'; }).join('') +
        '</div></div>' + linhas + '</div></div>';
    }).join('');
    const ppNivel = (state.plano && state.plano.pontoPartida && state.plano.pontoPartida.nivel) || 'zero';

    const m = abrirModal(
      '<div class="gp-wizard">' +
      '<div class="gp-passos" id="gp-passos">' +
      ['Rotina', 'Dificuldade', 'O que já sei', 'Prazo', 'Estratégia'].map(function (t, i) {
        return '<span class="gp-passo' + (i === 0 ? ' ativo' : '') + '" data-passo-dot="' + (i + 1) + '"><b>' + (i + 1) + '</b>' + t + '</span>';
      }).join('') +
      '</div>' +
      '<form id="form-gerar-plano-rotina">' +

      // ---- Passo 1: rotina (dias, horas e tempo por bloco) ----
      '<section class="gp-step" data-step="1">' +
      '<h3>Quais dias e quantas horas você estuda?</h3>' +
      '<p class="sub">Marque os dias e ajuste as horas. O total aparece em tempo real.</p>' +
      '<div class="rotina-dias">' + diasHtml + '</div>' +
      '<div class="rotina-totais"><div><label>Total planejado</label><div class="rotina-total" id="gp-total">' + formatarHorasSemana(totalAtual / 60) + '</div></div></div>' +
      '<label>Quanto tempo em cada disciplina por bloco?</label>' +
      '<p class="sub">Quanto tempo seguido você fica em uma mesma disciplina antes de trocar.</p>' +
      '<div class="gp-bloco-grade">' +
      '<div class="gp-bloco-campo"><select id="gp-min-bloco">' + optsMin + '</select><span class="gp-bloco-rotulo">Mínimo</span></div>' +
      '<div class="gp-bloco-campo"><select id="gp-max-bloco">' + optsMax + '</select><span class="gp-bloco-rotulo">Máximo</span></div>' +
      '</div>' +
      '</section>' +

      // ---- Passo 2: dificuldade por disciplina ----
      '<section class="gp-step oculto" data-step="2">' +
      '<h3>Como você se sente em cada disciplina?</h3>' +
      '<p class="sub">Isso ajuda o sistema a reservar mais tempo para o que é mais difícil para você e menos para o que você já domina.</p>' +
      '<div class="gp-dif-lista">' + (difHtml || '<p class="sub">Nenhuma disciplina para configurar.</p>') + '</div>' +
      '</section>' +

      // ---- Passo 3: o que já sei (ponto de partida) ----
      '<section class="gp-step oculto" data-step="3">' +
      '<h3>O que você já estudou?</h3>' +
      '<p class="sub">Marque, <strong>por tópico</strong>, o que você já viu. Na dúvida deixe em "Nunca vi" — é melhor rever do que pular. O que você marcar como <strong>já domino</strong> entra direto em revisão/questões, sem repetir a teoria.</p>' +
      '<div class="gp-pp-nivel" role="radiogroup" aria-label="Seu ponto de partida">' +
      [['zero', 'Começando do zero'], ['intermediario', 'Intermediário'], ['avancado', 'Avançado']].map(function (o) {
        return '<button type="button" class="gp-pp-nivel-opt' + (ppNivel === o[0] ? ' ativo' : '') + '" data-pp-nivel="' + o[0] + '">' + o[1] + '</button>';
      }).join('') +
      '</div>' +
      '<div class="gp-pp-lista">' + (ppHtml || '<p class="sub">Nenhuma disciplina para configurar.</p>') + '</div>' +
      '</section>' +

      // ---- Passo 4: prazo (projeção dinâmica: rotina + bagagem + data) ----
      '<section class="gp-step oculto" data-step="4">' +
      '<h3>Para quando é o seu objetivo?</h3>' +
      (temJanela
        ? '<div class="aviso aviso-info"><strong>📅 ' + esc(nomeCurtoConcurso()) + ' tem data prevista: ' + esc(janelaTexto) + '.</strong><br>' +
          'O plano vai se organizar para te deixar pronto até lá — teoria, revisões e questões no tempo certo. Tem informação mais precisa? Ajuste a data abaixo.</div>' +
          '<label for="gp-data-alvo">Data-alvo da prova</label>' +
          seletorMesHtml('gp-data-alvo', janelaFim, { opcional: true })
        : '<div class="aviso aviso-info">Este concurso ainda não tem data definida. Se quiser, mire numa data; senão, seguimos no seu ritmo, focando em cobrir e reter o conteúdo.</div>' +
          '<label for="gp-data-alvo">Tem uma data em mente? (opcional)</label>' +
          seletorMesHtml('gp-data-alvo', '', { opcional: true })) +
      '<div class="gp-prazo-proj" id="gp-prazo-proj"></div>' +
      '<input type="hidden" id="gp-meses" value="' + mesesInicial + '">' +
      '</section>' +

      // ---- Passo 5: estratégia ----
      '<section class="gp-step oculto" data-step="5">' +
      '<label>Como voce quer organizar o plano?</label>' +
      '<div class="toggle-ordem" role="radiogroup" aria-label="Tipo de planejamento">' +
      '<label class="toggle-ordem-opt"><input type="radio" name="gp-modo" value="cronograma"' + (((state.plano && state.plano.modoPlanejamento) || 'cronograma') !== 'ciclo' ? ' checked' : '') + '>' +
      '<span><strong>Cronograma flexivel</strong><small>Distribui os topicos nos dias da sua rotina e preenche a agenda.</small></span></label>' +
      '<label class="toggle-ordem-opt"><input type="radio" name="gp-modo" value="ciclo"' + ((state.plano && state.plano.modoPlanejamento) === 'ciclo' ? ' checked' : '') + '>' +
      '<span><strong>Ciclo de estudos</strong><small>Gera uma fila com proximo topico sugerido, no seu ritmo.</small></span></label>' +
      '</div>' +
      '<h3>Estratégia de estudo</h3>' +
      '<label>Ordem de ataque ao conteúdo</label>' +
      '<div class="toggle-ordem" role="radiogroup" aria-label="Ordem de ataque ao conteúdo">' +
      '<label class="toggle-ordem-opt"><input type="radio" name="gp-ordem" value="edital"' + (ordemAtual === 'edital' ? ' checked' : '') + '>' +
      '<span><strong>Ordem do edital</strong><small>Segue a sequência publicada no edital.</small></span></label>' +
      '<label class="toggle-ordem-opt"><input type="radio" name="gp-ordem" value="incidencia"' + (ordemAtual === 'incidencia' ? ' checked' : '') + '>' +
      '<span><strong>Ordem de incidência (80/20)</strong><small>Ataca primeiro os tópicos mais cobrados nas provas.</small></span></label>' +
      '</div>' +
      '</section>' +

      '<div class="modal-acoes gp-nav">' +
      '<button type="button" class="botao-quieto" id="gp-cancelar">Cancelar</button>' +
      '<button type="button" class="botao-quieto oculto" id="gp-voltar">← Voltar</button>' +
      '<button type="button" id="gp-proximo">Próximo →</button>' +
      '<button type="submit" class="oculto" id="gp-gerar">' + (ehAtualizacao ? 'Atualizar plano' : 'Gerar plano') + '</button>' +
      '</div></form></div>'
    );
    m.classList.add('modal-amplo');
    ligarSeletoresMes(m);

    // Se o assistente foi aberto logo após criar um plano (fluxo "Iniciar plano")
    // e o usuário sair sem gerar, descartamos o plano recém-criado para não
    // deixar um plano "fantasma" — o catálogo volta a mostrar "Iniciar plano".
    let planoGerado = false;
    function descartarPlanoNovoSeNecessario() {
      if (planoGerado || !opcoes.novoPlanoId) return;
      if (!state.planos.some(function (p) { return p.id === opcoes.novoPlanoId; })) return;
      limparDadosVinculados(opcoes.novoPlanoId);
      window.Store.removerPlano(state, opcoes.novoPlanoId);
      sanearTimerOrfao({ forcar: true });
      if (opcoes.planoAnteriorId && state.planos.some(function (p) { return p.id === opcoes.planoAnteriorId; })) {
        window.Store.ativarPlano(state, opcoes.planoAnteriorId);
      }
      editalAbertas = new Set();
      salvar();
      render();
    }
    // Qualquer caminho de fechamento (botão, clique fora, hashchange/voltar)
    // passa por fecharModal → este hook descarta o plano não confirmado.
    aoFecharModal = descartarPlanoNovoSeNecessario;

    // navegação do assistente
    let passo = 1;
    const TOTAL_PASSOS = 5;
    function mostrarPasso(n) {
      passo = Math.max(1, Math.min(TOTAL_PASSOS, n));
      m.querySelectorAll('.gp-step').forEach(function (s) {
        s.classList.toggle('oculto', parseInt(s.getAttribute('data-step'), 10) !== passo);
      });
      m.querySelectorAll('[data-passo-dot]').forEach(function (d) {
        const i = parseInt(d.getAttribute('data-passo-dot'), 10);
        d.classList.toggle('ativo', i === passo);
        d.classList.toggle('concluido', i < passo);
      });
      m.querySelector('#gp-voltar').classList.toggle('oculto', passo === 1);
      m.querySelector('#gp-proximo').classList.toggle('oculto', passo === TOTAL_PASSOS);
      m.querySelector('#gp-gerar').classList.toggle('oculto', passo !== TOTAL_PASSOS);
      if (passo === 4) atualizarPrazoProjecao();
    }

    function rotinaDoModal() {
      const cfg = { dias: {}, minBloco: parseInt(m.querySelector('#gp-min-bloco').value, 10), maxBloco: parseInt(m.querySelector('#gp-max-bloco').value, 10) };
      ROTINA_DIAS.forEach(function (d) {
        const ativo = m.querySelector('[data-rot-ativo="' + d.id + '"]').checked;
        const minutos = Math.max(0, Math.min(720, parseHorasDia(m.querySelector('[data-rot-horas="' + d.id + '"]').value)));
        cfg.dias[d.id] = { ativo: ativo, minutos: minutos };
      });
      if (cfg.maxBloco < cfg.minBloco) cfg.maxBloco = cfg.minBloco;
      return cfg;
    }
    function atualizarTotal() {
      const total = totalMinutosRotina(rotinaDoModal()) / 60;
      const meses = parseInt(m.querySelector('#gp-meses').value, 10);
      const ideal = horasIdeaisSemanaPlano(entrada, meses);
      const ok = total >= ideal;
      const el = m.querySelector('#gp-total');
      const idealEl = m.querySelector('#gp-total-ideal');
      const feedback = m.querySelector('#gp-feedback');
      if (el) {
        el.textContent = formatarHorasSemana(total);
        el.classList.toggle('rotina-total-alerta', !ok);
        el.classList.toggle('rotina-total-ok', ok);
      }
      if (idealEl) idealEl.textContent = formatarHorasSemana(ideal);
      if (feedback) {
        const macroNome = nomeRitmoPorMeses(entrada, meses);
        feedback.classList.toggle('alerta', !ok);
        feedback.classList.toggle('ok', ok);
        feedback.textContent = ok
          ? 'Sua rotina acompanha bem o ritmo ' + macroNome + '.'
          : 'Sua rotina está abaixo do ritmo ' + macroNome + ' — você ainda avança, só mais devagar. Aumente as horas ou escolha um ritmo mais tranquilo.';
      }
    }
    atualizarTotal();
    m.querySelectorAll('[data-rot-ativo], #gp-min-bloco, #gp-max-bloco').forEach(function (el) {
      el.addEventListener('change', atualizarTotal);
      el.addEventListener('input', atualizarTotal);
    });
    // Horas por dia: NÃO reescrevemos o campo enquanto a pessoa digita (reescrever
    // o value a cada tecla reposiciona o cursor e trava a digitação, sobretudo no
    // celular). Durante a digitação só atualizamos o total (já limitado a 0–720).
    // Ao SAIR do campo (blur) normalizamos para HH:MM e limitamos — aí some
    // qualquer lixo digitado (ex.: "66666" vira "12:00").
    m.querySelectorAll('[data-rot-horas]').forEach(function (el) {
      el.addEventListener('input', atualizarTotal);
      el.addEventListener('blur', function () {
        el.value = formatarHorasDia(Math.max(0, Math.min(720, parseHorasDia(el.value))));
        atualizarTotal();
      });
    });

    // Passo 4 — Prazo: projeção dinâmica (rotina + bagagem + data).
    // Esforço restante = horas dos tópicos AINDA não dominados (lê os selects do
    // passo "O que já sei"), com folga de 1.8 para revisão/questões.
    function esforcoRestanteHoras() {
      const nivelPorTop = {};
      m.querySelectorAll('.gp-pp-sel').forEach(function (s) { nivelPorTop[s.getAttribute('data-pp-top')] = s.value; });
      let h = 0;
      state.disciplinas.forEach(function (d) {
        if (d.id === 'ORF') return;
        (d.topicos || []).forEach(function (t) {
          if (t.orfao) return;
          const base = t.horas_estimadas || 2;
          const nivel = nivelPorTop[t.id] || nivelConhDoStatus(t);
          const fator = nivel === 'domino' ? 0.15 : nivel === 'estudei' ? 0.5 : 1;
          h += base * fator;
        });
      });
      return h * 1.8;
    }
    function atualizarPrazoProjecao() {
      const box = m.querySelector('#gp-prazo-proj');
      if (!box) return;
      const horasSem = totalMinutosRotina(rotinaDoModal()) / 60;
      const esforco = esforcoRestanteHoras();
      const dataAlvo = m.querySelector('#gp-data-alvo').value;
      if (horasSem < 1 || esforco <= 0) {
        box.className = 'gp-prazo-proj aviso aviso-alerta';
        box.innerHTML = 'Marque pelo menos um dia de estudo na Rotina para eu calcular o prazo.';
        return;
      }
      const semanas = esforco / horasSem;
      const nMeses = Math.max(1, Math.round(semanas / 4.345));
      // o plano segue a data da prova quando há; senão, o ritmo natural do aluno
      m.querySelector('#gp-meses').value = dataAlvo ? mesesAteMes(dataAlvo) : nMeses;
      const cabe = formatarHorasSemana(horasSem).replace(' na semana', 'h/sem').replace('h/semh/sem', 'h/sem');
      const horasTxt = '<strong>' + (Math.round(horasSem * 10) / 10).toString().replace('.', ',') + 'h/sem</strong>';
      let html = 'No seu ritmo de ' + horasTxt + ' e com o que você já marcou que sabe, você cobre todo o edital em <strong>~' + nMeses + (nMeses === 1 ? ' mês' : ' meses') + '</strong>.';
      let classe = 'aviso-info';
      if (dataAlvo) {
        const ateProva = mesesAteMes(dataAlvo);
        const folga = ateProva - nMeses;
        if (folga >= 2) {
          classe = 'aviso-ok';
          html += '<br>✅ Isso fecha cerca de <strong>' + folga + ' meses antes</strong> de ' + esc(D.formatarMesBR(dataAlvo)) + ' — sobra tempo para revisar e fazer muitas questões. Dá até para aprofundar.';
        } else if (folga >= 0) {
          classe = 'aviso-info';
          html += '<br>🟡 Dá para fechar <strong>em cima da prova</strong> (' + esc(D.formatarMesBR(dataAlvo)) + '). Toda semana conta — segure a constância.';
        } else {
          classe = 'aviso-alerta';
          const horasNec = Math.ceil(esforco / Math.max(1, ateProva * 4.345));
          html += '<br>🟠 No seu ritmo, o edital fecharia <strong>depois</strong> da prova. ' +
            (horasNec <= 60
              ? 'Para cobrir tudo até ' + esc(D.formatarMesBR(dataAlvo)) + ', estude <strong>~' + horasNec + 'h/sem</strong> (hoje são ' + Math.round(horasSem) + 'h) <strong>ou</strong> ataque primeiro a alta incidência (80/20) na próxima tela.'
              : 'Não dá para cobrir <strong>todo</strong> o conteúdo a tempo — foque no <strong>essencial: ataque a alta incidência (80/20)</strong> na próxima tela e priorize o que mais cai.');
        }
      } else {
        html += '<br>Sem data definida: seguimos no seu ritmo, focando em <strong>cobrir e reter</strong> o conteúdo. Quando a data sair, é só ajustar aqui.';
      }
      box.className = 'gp-prazo-proj aviso ' + classe;
      box.innerHTML = html;
    }
    const dataAlvoEl = m.querySelector('#gp-data-alvo');
    if (dataAlvoEl) {
      dataAlvoEl.addEventListener('change', atualizarPrazoProjecao);
      dataAlvoEl.addEventListener('input', atualizarPrazoProjecao);
    }

    // Passo 2 — botões de dificuldade por disciplina
    m.querySelectorAll('.gp-dif-row').forEach(function (row) {
      row.querySelectorAll('[data-dif]').forEach(function (b) {
        b.addEventListener('click', function () {
          row.querySelectorAll('[data-dif]').forEach(function (x) { x.classList.toggle('ativo', x === b); });
        });
      });
    });

    // Passo 3 — "O que já sei": expandir disciplina, atalho "marcar todos" e resumo.
    function ppResumoDisc(disc) {
      const sels = disc.querySelectorAll('.gp-pp-sel');
      let dom = 0, est = 0;
      sels.forEach(function (s) { if (s.value === 'domino') dom++; else if (s.value === 'estudei') est++; });
      const partes = [];
      if (dom) partes.push(dom + ' já domino');
      if (est) partes.push(est + ' já estudei');
      const el = disc.querySelector('[data-pp-resumo]');
      if (el) el.textContent = partes.length ? partes.join(' · ') : 'tudo novo';
    }
    m.querySelectorAll('.gp-pp-disc').forEach(function (disc) {
      const cab = disc.querySelector('[data-pp-toggle]');
      const corpo = disc.querySelector('.gp-pp-corpo');
      if (cab) cab.addEventListener('click', function () { corpo.classList.toggle('oculto'); disc.classList.toggle('aberta', !corpo.classList.contains('oculto')); });
      disc.querySelectorAll('[data-pp-bulk]').forEach(function (b) {
        b.addEventListener('click', function () {
          const v = b.getAttribute('data-pp-bulk');
          disc.querySelectorAll('.gp-pp-sel').forEach(function (s) { s.value = v; });
          ppResumoDisc(disc);
        });
      });
      disc.querySelectorAll('.gp-pp-sel').forEach(function (s) { s.addEventListener('change', function () { ppResumoDisc(disc); }); });
      ppResumoDisc(disc);
    });
    let ppNivelSel = ppNivel;
    m.querySelectorAll('[data-pp-nivel]').forEach(function (b) {
      b.addEventListener('click', function () {
        ppNivelSel = b.getAttribute('data-pp-nivel');
        m.querySelectorAll('[data-pp-nivel]').forEach(function (x) { x.classList.toggle('ativo', x === b); });
        // nível geral só ajusta o DEFAULT da estratégia (não marca tópicos):
        // do zero → ordem do edital; intermediário/avançado → incidência (80/20).
        const ordemAlvo = ppNivelSel === 'zero' ? 'edital' : 'incidencia';
        const r = m.querySelector('input[name="gp-ordem"][value="' + ordemAlvo + '"]');
        if (r) r.checked = true;
      });
    });

    // navegação
    m.querySelector('#gp-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#gp-voltar').addEventListener('click', function () { mostrarPasso(passo - 1); });
    m.querySelector('#gp-proximo').addEventListener('click', function () {
      if (passo === 1 && totalMinutosRotina(rotinaDoModal()) < 1) {
        toast('Marque pelo menos um dia com tempo de estudo.', 'erro');
        return;
      }
      mostrarPasso(passo + 1);
    });
    m.querySelectorAll('[data-passo-dot]').forEach(function (d) {
      d.addEventListener('click', function () {
        const alvo = parseInt(d.getAttribute('data-passo-dot'), 10);
        if (alvo <= passo) mostrarPasso(alvo); // só permite voltar pelos passos
      });
    });

    m.querySelector('#form-gerar-plano-rotina').addEventListener('submit', function (e) {
      e.preventDefault();
      const dataAlvo = m.querySelector('#gp-data-alvo') ? m.querySelector('#gp-data-alvo').value : '';
      const meses = dataAlvo ? mesesAteMes(dataAlvo) : parseInt(m.querySelector('#gp-meses').value, 10);
      const rotinaNova = rotinaDoModal();
      const totalMinutos = totalMinutosRotina(rotinaNova);
      if (totalMinutos < 1) { toast('Marque pelo menos um dia com tempo de estudo.', 'erro'); mostrarPasso(1); return; }
      const horas = Math.max(1, Math.round(totalMinutos / 60));
      const ordemEl = m.querySelector('input[name="gp-ordem"]:checked');
      const ordemAtaque = ordemEl ? ordemEl.value : 'edital';
      const modoEl = m.querySelector('input[name="gp-modo"]:checked');
      const modoPlano = modoEl ? modoEl.value : 'cronograma';
      // grava a dificuldade escolhida em cada disciplina (entra no cálculo do cronograma)
      m.querySelectorAll('.gp-dif-row').forEach(function (row) {
        const id = row.getAttribute('data-dif-disc');
        const sel = row.querySelector('[data-dif].ativo');
        const disc = state.disciplinas.find(function (x) { return x.id === id; });
        if (disc && sel) disc.dificuldade = sel.getAttribute('data-dif');
      });
      // Ponto de partida: semeia o status de cada tópico a partir do que o aluno
      // já sabe. "Já estudei"/"já domino" NÃO agendam revisão aqui — viram tópicos
      // pendentes com bagagem (t.bagagem), que voltam à fila com prioridade menor
      // para a 1ª passada guiada. A curva de revisão só nasce desse estudo real
      // (data conhecida), nunca de uma data passada que não dá para saber.
      m.querySelectorAll('.gp-pp-sel').forEach(function (sel) {
        const t = D.topicoPorId(state, sel.getAttribute('data-pp-top'));
        if (!t) return;
        t.status = statusDoNivelConh(sel.value, t.status);
        if (sel.value === 'estudei' || sel.value === 'domino') t.bagagem = sel.value;
        else delete t.bagagem;
      });
      state.plano.pontoPartida = { nivel: ppNivelSel, definidoEm: D.hojeISO() };
      // Data-alvo definida no passo Prazo → vira a janela da prova do plano.
      if (dataAlvo) {
        const radarP = state.plano.radar || {};
        const iniP = (radarP.janela_prova && radarP.janela_prova[0] && radarP.janela_prova[0] <= dataAlvo) ? radarP.janela_prova[0] : dataAlvo;
        state.plano.radar = Object.assign({}, radarP, { janela_prova: [iniP, dataAlvo], confianca: 'manual' });
      }
      state.config.rotinaEstudos = rotinaNova;
      const nomeRitmo = nomeRitmoPorMeses(entrada, meses);
      if (modoPlano === 'ciclo') {
        state.plano.ordemAtaque = ordemAtaque;
        state.plano.modoPlanejamento = 'ciclo';
        limparCronogramasPlanoAtivo();
        const cicloBlocos = D.sugerirCiclo(state, {
          minutosSemana: totalMinutos,
          minBloco: rotinaNova.minBloco,
          maxBloco: rotinaNova.maxBloco,
          ordemAtaque: ordemAtaque
        });
        if (cicloBlocos.length === 0) { toast('Adicione disciplinas antes de gerar o ciclo.', 'erro'); return; }
        state.plano.ciclo = { blocos: cicloBlocos, volta: 1 };
        const entradaAtiva = entradaPlanoAtivo();
        if (entradaAtiva) {
          entradaAtiva.cronogramas = {};
          entradaAtiva.plano.modoPlanejamento = 'ciclo';
          entradaAtiva.plano.ciclo = state.plano.ciclo;
          entradaAtiva.plano.ordemAtaque = ordemAtaque;
        }
        limparAgendaGeradaPlano(state.planoAtivoId);
        salvar();
      } else {
        if (!aplicarPlanoDuracaoAoAtivo(meses, horas, true, ordemAtaque, nomeRitmo, ehAtualizacao)) return;
      }
      planoGerado = true; // concluiu o assistente: o plano deixa de ser "fantasma"
      if (state.plano) delete state.plano.rascunho; // confirmado: não é mais rascunho
      const resumoTroca = opcoes.trocaPlano ? finalizarTrocaPlano(opcoes.trocaPlano, entrada) : null;
      fecharModal();
      const cron = D.cronogramaAtivo(state);
      agendaRef = modoPlano === 'ciclo' ? D.segundaDaSemana(D.hojeISO()) : (cron.length ? cron[0].inicio : D.segundaDaSemana(D.hojeISO()));
      agendaModo = 'semana';
      render();
      const complementoTroca = resumoTroca && opcoes.trocaPlano.modo === 'reaproveitar'
        ? ' · ' + resumoTroca.sessoes + ' sessões e ' + resumoTroca.questoes + ' questões reaproveitadas'
        : '';
      toast('Plano ' + nomeRitmo + (ehAtualizacao ? ' atualizado — histórico preservado' : ' gerado — calendário preenchido') + complementoTroca, 'sucesso');
    });

    mostrarPasso(1);
  }

  function normalizarCabecalho(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  }

  function valorLinha(row, nomes) {
    const mapa = {};
    Object.keys(row).forEach(function (k) { mapa[normalizarCabecalho(k)] = row[k]; });
    for (let i = 0; i < nomes.length; i++) {
      const v = mapa[normalizarCabecalho(nomes[i])];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
  }

  function siglaDisciplina(nome, usada) {
    const base = String(nome || 'DISC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z\s]/g, ' ')
      .trim().split(/\s+/).filter(function (p) { return !/^(de|da|do|das|dos|e)$/i.test(p); })
      .map(function (p) { return p[0]; }).join('').slice(0, 4).toUpperCase() || 'DISC';
    let sigla = base;
    let n = 2;
    while (usada[sigla]) sigla = (base.slice(0, 3) + n++).slice(0, 4);
    usada[sigla] = true;
    return sigla;
  }

  function planoJsonDeLinhas(rows, nome) {
    const usadas = {};
    const porDisc = {};
    rows.forEach(function (row) {
      const discNome = String(valorLinha(row, ['disciplina', 'materia', 'matéria']) || '').trim();
      const topicoNome = String(valorLinha(row, ['topico', 'tópico', 'assunto', 'conteudo', 'conteúdo']) || '').trim();
      if (!discNome || !topicoNome) return;
      const siglaPlanilha = String(valorLinha(row, ['sigla', 'id disciplina', 'codigo', 'código']) || '').trim().toUpperCase();
      const idDisc = siglaPlanilha || Object.keys(porDisc).find(function (id) { return porDisc[id].nome === discNome; }) || siglaDisciplina(discNome, usadas);
      const disc = porDisc[idDisc] = porDisc[idDisc] || {
        id: idDisc,
        nome: discNome,
        cor: String(valorLinha(row, ['cor']) || ['#2454D6', '#1F7A4D', '#B8762B', '#8E44AD'][Object.keys(porDisc).length % 4]),
        peso: parseFloat(valorLinha(row, ['peso', 'importancia', 'importância'])) || 1,
        base_teorica: 'pdf',
        topicos: []
      };
      const n = disc.topicos.length + 1;
      disc.topicos.push({
        id: idDisc + '-' + String(n).padStart(2, '0'),
        nome: topicoNome,
        incidencia_pct: parseFloat(valorLinha(row, ['incidencia', 'incidência', 'chance'])) || 0,
        prioridade: parseInt(valorLinha(row, ['prioridade']), 10) || 2,
        horas_estimadas: parseFloat(valorLinha(row, ['horas', 'tempo'])) || 2,
        semana_sugerida: parseInt(valorLinha(row, ['semana', 'ordem']), 10) || null
      });
    });
    return {
      versao: 1,
      gerado_em: D.hojeISO(),
      plano: { concurso: nome || 'Plano importado', banca: '', meta: { corte_pct: 70 }, radar: null, ritmos: { ativo: 'plano_6m' } },
      disciplinas: Object.keys(porDisc).map(function (id) { return porDisc[id]; }),
      cronograma: {}
    };
  }

  function parseCsv(texto) {
    const linhas = texto.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (linhas.length < 2) return [];
    const sep = linhas[0].indexOf(';') >= 0 ? ';' : ',';
    const cab = linhas[0].split(sep).map(function (c) { return c.trim(); });
    return linhas.slice(1).map(function (linha) {
      const cols = linha.split(sep);
      const row = {};
      cab.forEach(function (c, i) { row[c] = (cols[i] || '').trim(); });
      return row;
    });
  }

  function lerArquivo(file, comoArrayBuffer) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = reject;
      if (comoArrayBuffer) fr.readAsArrayBuffer(file);
      else fr.readAsText(file, 'utf-8');
    });
  }

  function telaPlanejamento() {
    const hoje = D.hojeISO();
    // plano com cronograma mas calendário vazio (ex.: importado antes da
    // sincronização automática): preenche a agenda uma única vez
    const cronAtivo = D.cronogramaAtivo(state);
    if (cronAtivo && cronAtivo.length > 0 &&
      !state.agenda.some(function (a) { return a.gerado && (!a.planoId || a.planoId === state.planoAtivoId); })) {
      if (sincronizarAgendaComCronograma() > 0) salvar();
    }
    let html = '<div class="cab-pagina"><div><h1>Planejamento</h1>' +
      '<p class="sub">Plano atual, check-in e agenda no mesmo lugar.</p></div></div>';

    // Aviso: plano com cronograma mas rotina sem nenhum dia de estudo ativo →
    // o calendário fica vazio. Oferece ir direto ajustar a rotina.
    if (state.plano && cronAtivo && cronAtivo.length > 0 && rotinaSemDiasAtivos()) {
      html += '<div class="card aviso-rotina"><span class="aviso-rotina-ic" aria-hidden="true">⚠️</span>' +
        '<div><strong>Sua rotina está sem dias de estudo.</strong>' +
        '<p class="sub" style="margin:0.15rem 0 0">Marque os dias e horas para o calendário ser preenchido.</p></div>' +
        '<button class="botao-mini" id="pl-ajustar-rotina">Ajustar rotina</button></div>';
    }

    // Check-in e plano atual lado a lado no desktop; empilhados no mobile. O card
    // do método (Cronograma/Ciclo) fica logo abaixo do check-in, na coluna
    // esquerda, aproveitando o espaço ao lado do card de plano atual.
    const checkin = checkinSemanalHtml();
    const temDisc = state.disciplinas.length > 0;
    // Seletor de método: cronograma fixo (por semana) OU ciclo de estudos
    // (fila ponderada que roda no ritmo do aluno). A tela Hoje segue o ativo.
    const modoPlan = (state.plano && state.plano.modoPlanejamento) || 'cronograma';
    const modoPlanCard = !temDisc ? '' :
      '<div class="card modo-plan-card"><div class="modo-plan-toggle" role="tablist">' +
      '<button type="button" class="modo-plan-op' + (modoPlan === 'cronograma' ? ' ativo' : '') + '" data-modo-plan="cronograma" role="tab" aria-selected="' + (modoPlan === 'cronograma') + '">📅 Cronograma</button>' +
      '<button type="button" class="modo-plan-op' + (modoPlan === 'ciclo' ? ' ativo' : '') + '" data-modo-plan="ciclo" role="tab" aria-selected="' + (modoPlan === 'ciclo') + '">🔄 Ciclo de estudos</button>' +
      '</div><p class="sub modo-plan-dica">' +
      (modoPlan === 'ciclo'
        ? 'Estude na ordem da fila, no seu ritmo. Fechou a volta, recomeça — sem amarrar matéria a dia da semana.'
        : 'Calendário por semana: arraste matérias para os dias e siga o plano.') +
      '</p></div>';

    html += '<div class="planejamento-topo' + (checkin ? '' : ' planejamento-topo-solo') + '">' +
      checkin +
      '<div class="planejamento-col-direita">' + planoAtualHtml() + '</div>' +
      '</div>';

    if (!temDisc) {
      return html + '<div class="card"><div class="estado-vazio"><span class="bolha bolha-pendente"></span>' +
        '<strong>Nenhuma disciplina ainda</strong>Escolha seu concurso e o sistema gera o plano — ou crie uma disciplina manual.' +
        '<p style="margin-top:1rem"><a class="botao" href="#planos">📚 Escolher meu concurso</a></p>' +
        '<p style="margin-top:0.6rem;display:flex;gap:0.6rem;justify-content:center;flex-wrap:wrap">' +
        '<button class="botao-secundario" id="pl-criar-disc">Criar disciplina</button>' +
        '<button class="botao-quieto" id="pl-em-branco-vazio">Plano manual</button></p></div></div>';
    }

    // Modo ciclo: o método ocupa a largura toda (não há paleta ao lado).
    if (modoPlan === 'ciclo') return html + '<div class="planejamento-metodo-paleta metodo-solo">' + modoPlanCard + '</div>' + cicloHtml();

    // Cronograma: método (Cronograma/Ciclo) e a paleta "Personalize" lado a lado.
    // paleta de disciplinas (arrastáveis) — no mobile mostra 1 linha (5) + "Ver mais"
    const discPaleta = state.disciplinas.filter(D.disciplinaAtivaPlanejamento);
    const chipsOcultos = Math.max(0, discPaleta.length - PALETA_LIMITE_MOBILE);
    // No celular o card fica recolhido por padrão (só o título) para ganhar espaço;
    // toca no título para abrir/fechar. No desktop o CSS mostra o corpo sempre.
    const paletaCard = '<div class="card planejamento-disciplinas-card' + (paletaExpandida ? ' paleta-aberta' : '') + '">' +
      '<button type="button" class="paleta-cabecalho" data-paleta-toggle aria-expanded="' + (paletaExpandida ? 'true' : 'false') + '">' +
      '<h3>Personalize seu plano de estudos</h3><span class="paleta-chevron" aria-hidden="true">▾</span></button>' +
      '<div class="paleta-corpo">' +
      '<p class="sub">Arraste uma matéria para um dia do calendário ou toque nela para agendar hoje.</p>' +
      '<div class="paleta-disc">' +
      discPaleta.map(function (d, i) {
        return '<button class="chip-disc' + (i >= PALETA_LIMITE_MOBILE ? ' chip-disc-extra' : '') + '" draggable="true" data-chip="' + esc(d.id) + '" style="background:' + esc(d.cor) + '" title="' + esc(d.nome) + '">' + esc(d.id) + '</button>';
      }).join('') +
      (chipsOcultos > 0 ? '<button type="button" class="chip-disc-vermais botao-mini botao-quieto" data-paleta-vermais aria-expanded="false">+' + chipsOcultos + '</button>' : '') +
      '<span class="paleta-dica">arraste para um dia · ou toque para agendar hoje</span>' +
      '<span class="paleta-disc-acoes"><button class="botao-mini botao-quieto" id="pl-gerenciar-disc">Gerenciar</button>' +
      '<button class="botao-mini botao-secundario" id="pl-nova-disc-card">+ Nova disciplina</button></span></div></div></div>';
    html += '<div class="planejamento-metodo-paleta">' + modoPlanCard + paletaCard + '</div>';

    // Calendário: visão semanal (arrastar/soltar entre os dias, com toque) e
    // visão mensal planejada — o aluno enxerga o que vem pela frente e pode
    // adiantar metas se sobrar tempo no mês.
    const rotulo = agendaModo === 'semana'
      ? D.formatarDataBR(agendaRef).slice(0, 5) + ' – ' + D.formatarDataBR(D.addDias(agendaRef, 6)).slice(0, 5) + ' · ' + agendaRef.slice(0, 4)
      : D.formatarMesBR(mesRef);
    html += ajustesAgendaHtml();
    html += regrasRecorrentesHtml();
    html += '<div class="agenda-toolbar">' +
      '<div class="agenda-nav">' +
      '<button class="botao-mini botao-quieto" id="pl-ant" aria-label="Anterior">‹</button>' +
      '<strong>' + rotulo + '</strong>' +
      '<button class="botao-mini botao-quieto" id="pl-prox" aria-label="Próximo">›</button>' +
      '<button class="botao-mini botao-quieto" id="pl-hoje">Hoje</button></div>' +
      '<div class="agenda-nav">' +
      '<button class="botao-mini ' + (agendaModo === 'semana' ? '' : 'botao-quieto') + '" data-modo-ag="semana">Semanal</button>' +
      '<button class="botao-mini ' + (agendaModo === 'mes' ? '' : 'botao-quieto') + '" data-modo-ag="mes">Mensal</button></div></div>';

    if (agendaModo === 'semana') {
      html += '<div class="agenda-grid">';
      for (let i = 0; i < 7; i++) {
        const data = D.addDias(agendaRef, i);
        const blocos = blocosDoDia(data);
        const revs = revisoesDoDia(data);
        const revsFeitas = revisoesConcluidasNoDia(data);
        const sims = simuladosDoDia(data);
        const revsMin = revs.reduce(function (n, r) { return n + D.duracaoRevisaoMin(r.tipo); }, 0);
        const revsFeitasMin = D.minutosRevisoesConcluidasNoDia(state, data);
        const simsMin = sims.reduce(function (n, s) { return n + (s.duracaoMin || 0); }, 0);
        const totalMin = blocos.reduce(function (n, b) { return n + blocoMinContado(b); }, 0) + revsMin + revsFeitasMin + simsMin;
        html += '<div class="agenda-dia' + (data === hoje ? ' dia-hoje' : '') + '" data-dia="' + esc(data) + '">' +
          '<div class="agenda-dia-cab"><span>' + DIAS_CURTOS[i] + ' <span class="num">' + data.slice(8, 10) + '</span></span>' +
          (totalMin > 0 ? '<span class="num">' + D.formatarMin(totalMin) + '</span>' : '') + '</div>' +
          revs.map(revisaoChipSemana).join('') +
          revsFeitas.map(revisaoChipConcluida).join('') +
          sims.map(simuladoChipSemana).join('') +
          blocos.map(function (b) {
            const d = D.disciplinaPorId(state, b.disciplinaId);
            const t = b.topicoId ? D.topicoPorId(state, b.topicoId) : null;
            const concluido = blocoAgendaConcluido(b);
            const parcial = blocoParcial(b);
            const excedente = blocoExcedenteMin(b);
            const tempoTxt = parcial
              ? 'faltam ' + D.formatarMin(blocoRestanteMin(b)) + ' de ' + D.formatarMin(b.duracaoMin || 0)
              : (excedente > 0
                // Estudou além do planejado: mostra o total real e o extra.
                ? D.formatarMin(blocoFeitoMin(b)) + ' (+' + D.formatarMin(excedente) + ')'
                : rotuloHorarioAgenda(b));
            const sub = tempoTxt + (t ? ' · ' + esc(t.nome) : '') + (b.extra ? ' · extra' : '') + (concluido ? ' · feito ✓' : '');
            const pct = parcial ? Math.min(100, Math.round((blocoFeitoMin(b) / (b.duracaoMin || 1)) * 100)) : 0;
            const barra = parcial ? '<span class="agenda-bloco-prog"><span style="width:' + pct + '%"></span></span>' : '';
            // No modo compacto (telas estreitas) só o título aparece; o detalhe
            // completo vai no title do bloco e fica acessível ao clicar/passar
            // o mouse, evitando que a grade da semana fique muito carregada.
            const dica = (d ? d.nome : b.disciplinaId) + ' · ' + (tempoTxt + (t ? ' · ' + t.nome : '') + (concluido ? ' · feito ✓' : ''));
            return '<div class="agenda-bloco' + (concluido ? ' feito' : '') + (parcial ? ' parcial' : '') + '" draggable="true" data-bloco="' + esc(b.id) + '" data-pos-dia="' + esc(data) + '" style="border-color:' + esc(d ? d.cor : '#9A9DA3') + '" role="button" tabindex="0" title="' + esc(dica) + '">' +
              '<span class="agenda-bloco-arrasto" aria-hidden="true">⠿</span>' +
              '<span class="agenda-bloco-texto"><span class="agenda-bloco-titulo">' + esc(d ? d.nome : b.disciplinaId) + '</span>' +
              '<span class="agenda-bloco-sub">' + sub + '</span>' + barra + '</span>' +
              (!concluido && !parcial ? '<button type="button" class="agenda-bloco-menu" data-bloco-menu="' + esc(b.id) + '" aria-label="Ações de ' + esc(d ? d.nome : b.disciplinaId) + '" title="Ações">•••</button>' : '') +
              '</div>';
          }).join('') +
          '<button class="agenda-add" data-add-dia="' + esc(data) + '" aria-label="Adicionar bloco em ' + D.formatarDataBR(data) + '">+</button></div>';
      }
      html += '</div>';
    } else {
      // Visão mensal com RÓTULOS: cada disciplina do dia vira um chip com o nome
      // (cor da disciplina), como um calendário de agenda. Tocar num dia abre os
      // detalhes. Em telas estreitas a grade rola na horizontal (min-width por
      // coluna) para os nomes continuarem legíveis.
      const MAX_CHIPS_MES = 4;
      const primeiroDia = mesRef + '-01';
      const iniGrade = D.segundaDaSemana(primeiroDia);
      html += '<div class="mes-scroll"><div class="mes-grid mes-grid-rotulos">' +
        DIAS_CURTOS.map(function (n) { return '<div class="mes-rotulo">' + n + '</div>'; }).join('');
      let cursor = iniGrade;
      for (let c = 0; c < 42; c++) {
        const noMes = cursor.slice(0, 7) === mesRef;
        if (c >= 35 && !noMes) break;
        const blocos = doAtivo(state.agenda).filter(function (a) { return a.data === cursor; }).sort(compararAgenda);
        // agrupa por disciplina (um chip por disciplina, somando o tempo do dia)
        const porDisc = [];
        const idxDisc = {};
        blocos.forEach(function (b) {
          if (idxDisc[b.disciplinaId] === undefined) { idxDisc[b.disciplinaId] = porDisc.length; porDisc.push({ id: b.disciplinaId, min: 0, feito: true }); }
          const g = porDisc[idxDisc[b.disciplinaId]];
          g.min += blocoMinContado(b);
          if (!blocoAgendaConcluido(b)) g.feito = false;
        });
        const revs = revisoesDoDia(cursor);
        const revsFeitas = revisoesConcluidasNoDia(cursor);
        const sims = simuladosDoDia(cursor);
        const revsMin = revs.reduce(function (n, r) { return n + D.duracaoRevisaoMin(r.tipo); }, 0);
        const revsFeitasMin = D.minutosRevisoesConcluidasNoDia(state, cursor);
        const simsMin = sims.reduce(function (n, s) { return n + (s.duracaoMin || 0); }, 0);
        const totalMin = blocos.reduce(function (n, b) { return n + blocoMinContado(b); }, 0) + revsMin + revsFeitasMin + simsMin;
        const todoFeito = blocos.length > 0 && blocos.every(blocoAgendaConcluido);
        const temConteudo = blocos.length > 0 || revs.length > 0 || revsFeitas.length > 0 || sims.length > 0;

        let chips = porDisc.slice(0, MAX_CHIPS_MES).map(function (g) {
          const d = D.disciplinaPorId(state, g.id);
          const cor = d ? d.cor : '#9A9DA3';
          return '<span class="mes-evento' + (g.feito ? ' feito' : '') + '" style="--disc-cor:' + esc(cor) +
            ';background:' + esc(corChipMes(cor)) + '" title="' + esc((d ? d.nome : g.id) + ' · ' + D.formatarMin(g.min)) + '">' +
            '<span class="mes-evento-nome">' + esc(d ? d.nome : g.id) + '</span>' +
            '<span class="mes-evento-hora">' + D.formatarMin(g.min) + '</span></span>';
        }).join('');
        if (porDisc.length > MAX_CHIPS_MES) chips += '<span class="mes-mais">+' + (porDisc.length - MAX_CHIPS_MES) + ' mais</span>';
        if (revs.length > 0) chips += '<span class="mes-evento mes-evento-rev" title="' + revs.length + (revs.length === 1 ? ' revisão' : ' revisões') + ' · ' + D.formatarMin(revsMin) + '"><span class="mes-evento-nome">🔁 ' + revs.length + (revs.length === 1 ? ' revisão' : ' revisões') + '</span></span>';
        if (revsFeitas.length > 0) chips += '<span class="mes-evento mes-evento-rev feito" title="' + revsFeitas.length + (revsFeitas.length === 1 ? ' revisão concluída' : ' revisões concluídas') + ' · ' + D.formatarMin(revsFeitasMin) + '"><span class="mes-evento-nome">✓ ' + revsFeitas.length + (revsFeitas.length === 1 ? ' revisão' : ' revisões') + '</span></span>';
        if (sims.length > 0) chips += '<span class="mes-evento mes-evento-sim feito" title="' + sims.length + (sims.length === 1 ? ' simulado' : ' simulados') + '"><span class="mes-evento-nome">📝 Simulado</span></span>';

        html += '<div class="mes-celula mes-celula-rotulos' + (noMes ? '' : ' fora-mes') + (cursor === hoje ? ' dia-hoje' : '') +
          (todoFeito ? ' dia-feito' : '') + '" data-dia-detalhe="' + esc(cursor) + '" role="button" tabindex="0" aria-label="' +
          D.formatarDataBR(cursor) + (temConteudo ? ' — ' + blocos.length + (blocos.length === 1 ? ' bloco, ' : ' blocos, ') + revs.length + (revs.length === 1 ? ' revisão' : ' revisões') + (sims.length > 0 ? ', ' + sims.length + (sims.length === 1 ? ' simulado' : ' simulados') : '') : ' — sem blocos') + '">' +
          '<div class="mes-celula-cab"><span class="mes-dia-num">' + cursor.slice(8, 10) + '</span>' +
          (totalMin > 0 ? '<span class="mes-dia-total">' + D.formatarMin(totalMin) + '</span>' : '') + '</div>' +
          (temConteudo ? '<div class="mes-eventos">' + chips + '</div>' : '') +
          '</div>';
        cursor = D.addDias(cursor, 1);
      }
      html += '</div></div><p style="font-size:0.78rem;color:var(--grafite);margin-top:0.5rem">Toque em um dia para ver os detalhes ou trocar os estudos.</p>';
    }
    return html;
  }

  // ---- Ciclo de estudos: fila ponderada de matérias com meta de tempo ----
  function cicloHtml() {
    normalizarCicloAtivoPelaRotina();
    const ciclo = state.plano.ciclo || { blocos: [], volta: 1 };
    const blocos = ciclo.blocos || [];

    if (blocos.length === 0) {
      return '<div class="card"><div class="estado-vazio"><span class="bolha bolha-pendente"></span>' +
        '<strong>Seu ciclo está vazio</strong>Gere uma fila ponderada pelas suas matérias (peso, incidência e seu desempenho) e ajuste arrastando.' +
        '<p style="margin-top:1rem;display:flex;gap:0.6rem;justify-content:center;flex-wrap:wrap">' +
        '<button class="botao" id="ciclo-gerar">✨ Gerar ciclo sugerido</button>' +
        '<button class="botao botao-secundario" id="ciclo-add">+ Adicionar matéria</button></p></div></div>';
    }

    const atual = D.blocoCicloAtual(ciclo);
    const volta = ciclo.volta || 1;
    // O progresso da volta considera só as disciplinas já ativas (rampa gradual).
    const ativos = D.blocosAtivosCiclo(ciclo);
    const totalMeta = ativos.reduce(function (n, b) { return n + (b.metaMin || 0); }, 0);
    const totalFeito = ativos.reduce(function (n, b) { return n + Math.min(b.feitoMin || 0, b.metaMin || 0); }, 0);
    const pctVolta = totalMeta > 0 ? Math.round((totalFeito / totalMeta) * 100) : 0;

    let html = '<div class="card ciclo-card">' +
      '<div class="ciclo-cab"><div><h3 style="margin:0">Sua fila do ciclo</h3>' +
      '<p class="sub" style="margin:0.15rem 0 0">Volta ' + (ciclo.volta || 1) + ' · ' + D.formatarMin(totalFeito) + ' de ' + D.formatarMin(totalMeta) + ' (' + pctVolta + '%)</p></div>' +
      '<div class="ciclo-cab-acoes"><button class="botao-mini botao-secundario" id="ciclo-gerar">✨ Regerar</button>' +
      '<button class="botao-mini botao-quieto" id="ciclo-reiniciar">↺ Reiniciar volta</button></div></div>' +
      '<div class="ciclo-lista">';

    blocos.forEach(function (b, i) {
      const d = D.disciplinaPorId(state, b.disciplinaId);
      const t = b.topicoId ? D.topicoPorId(state, b.topicoId) : null;
      const feito = Math.min(b.feitoMin || 0, b.metaMin || 0);
      const completo = feito >= (b.metaMin || 0);
      const ehAtual = atual && atual.id === b.id;
      const bloqueado = (b.voltaInicio || 1) > volta; // entra numa volta futura (rampa)
      const pct = b.metaMin > 0 ? Math.round((feito / b.metaMin) * 100) : 0;
      const cor = d ? d.cor : '#9A9DA3';
      html += '<div class="ciclo-bloco' + (completo ? ' completo' : '') + (ehAtual ? ' atual' : '') + (bloqueado ? ' ciclo-bloco-bloqueado' : '') +
        '" draggable="true" data-ciclo-bloco="' + esc(b.id) + '" style="border-left-color:' + esc(cor) + '">' +
        '<span class="ciclo-bloco-arrasto" aria-hidden="true">⠿</span>' +
        '<div class="ciclo-bloco-info">' +
        '<div class="ciclo-bloco-topo"><span class="ciclo-bloco-nome">' + esc(d ? d.nome : b.disciplinaId) +
        (ehAtual ? ' <span class="ciclo-badge-agora">agora</span>' : '') +
        (bloqueado ? ' <span class="ciclo-badge-volta">entra na volta ' + (b.voltaInicio || 1) + '</span>' : '') +
        (completo ? ' <span class="ciclo-badge-ok">✓</span>' : '') + '</span>' +
        '<span class="ciclo-bloco-min">' + D.formatarMin(feito) + ' / ' + D.formatarMin(b.metaMin || 0) + '</span></div>' +
        (t ? '<span class="ciclo-bloco-topico">🎯 ' + esc(t.nome) + '</span>' : '') +
        '<div class="ciclo-barra"><span style="width:' + pct + '%;background:' + esc(cor) + '"></span></div>' +
        '</div>' +
        '<div class="ciclo-bloco-acoes">' +
        '<button class="ciclo-seta botao-mini botao-quieto" data-ciclo-mover="cima" data-id="' + esc(b.id) + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Subir">▲</button>' +
        '<button class="ciclo-seta botao-mini botao-quieto" data-ciclo-mover="baixo" data-id="' + esc(b.id) + '"' + (i === blocos.length - 1 ? ' disabled' : '') + ' aria-label="Descer">▼</button>' +
        '<button class="botao-mini botao-quieto" data-ciclo-editar="' + esc(b.id) + '" aria-label="Editar">✏️</button>' +
        '<button class="botao-mini botao-quieto" data-ciclo-remover="' + esc(b.id) + '" aria-label="Remover">✕</button>' +
        '</div></div>';
    });

    html += '</div>' +
      '<div class="ciclo-rodape"><button class="botao-mini botao-secundario" id="ciclo-add">+ Adicionar matéria</button>' +
      '<span class="paleta-dica">arraste pelo ⠿ ou use ▲▼ para reordenar</span></div>' +
      '</div>';
    return html;
  }

  // Tela de detalhes de um dia (a partir da visão mensal estilo Google)
  function abrirDetalhesDia(dataISO) {
    const blocos = blocosDoDia(dataISO);
    const revs = revisoesDoDia(dataISO);
    const revsFeitas = revisoesConcluidasNoDia(dataISO);
    const sims = simuladosDoDia(dataISO);
    const revsMin = revs.reduce(function (n, r) { return n + D.duracaoRevisaoMin(r.tipo); }, 0);
    const revsFeitasMin = D.minutosRevisoesConcluidasNoDia(state, dataISO);
    const simsMin = sims.reduce(function (n, s) { return n + (s.duracaoMin || 0); }, 0);
    const totalMin = blocos.reduce(function (n, b) { return n + blocoMinContado(b); }, 0) + revsMin + revsFeitasMin + simsMin;
    const feitos = blocos.filter(blocoAgendaConcluido).length;
    const simsHtml = sims.length === 0 ? '' :
      '<div class="dia-detalhe-revs"><h4 class="dia-detalhe-revs-tit">📝 Simulados do dia</h4><div class="dia-detalhe-lista">' +
      sims.map(function (s) {
        const r = resumoSimulado(s);
        const tipoTxt = s.tipo === 'total' ? 'Simulado total' : s.tipo === 'parcial' ? 'Simulado parcial' : 'Simulado';
        const sub = (r.total > 0 ? r.certas + '/' + r.total + ' acertos' + (r.pct != null ? ' · ' + r.pct + '%' : '') : 'registrado') +
          (s.duracaoMin ? ' · ' + D.formatarMin(s.duracaoMin) : '');
        return '<button type="button" class="dia-detalhe-item dia-detalhe-rev" data-dia-sim="' + esc(s.id) + '" style="--disc-cor:#3fcf8e">' +
          '<span class="dia-detalhe-cor" style="background:#3fcf8e"></span>' +
          '<span class="dia-detalhe-info"><span class="dia-detalhe-disc">' + esc(tipoTxt) + '</span>' +
          '<span class="dia-detalhe-sub">' + esc(sub) + '</span></span>' +
          '<span class="dia-detalhe-seta">›</span></button>';
      }).join('') + '</div></div>';
    const revsHtml = revs.length === 0 ? '' :
      '<div class="dia-detalhe-revs"><h4 class="dia-detalhe-revs-tit">🔁 Revisões do dia</h4><div class="dia-detalhe-lista">' +
      revs.map(function (r) {
        const t = D.topicoPorId(state, r.topicoId);
        const d = D.disciplinaDoTopico(state, r.topicoId);
        const cor = d ? d.cor : '#9A9DA3';
        return '<div class="dia-detalhe-item dia-detalhe-rev" style="--disc-cor:' + esc(cor) + '">' +
          '<span class="dia-detalhe-cor" style="background:' + esc(cor) + '"></span>' +
          '<span class="dia-detalhe-info"><span class="dia-detalhe-disc">' + (t ? esc(t.nome) : 'Revisão') + '</span>' +
          '<span class="dia-detalhe-sub">' + D.formatarMin(D.duracaoRevisaoMin(r.tipo)) + ' · revisão ' + esc(rotuloTipoRevisao(r.tipo)) + '</span></span>' +
          '<button type="button" class="botao-mini botao-quieto" data-mover-rev="' + esc(r.id) + '">Mover</button></div>';
      }).join('') + '</div></div>';
    const revsFeitasHtml = revsFeitas.length === 0 ? '' :
      '<div class="dia-detalhe-revs"><h4 class="dia-detalhe-revs-tit">✓ Revisões concluídas</h4><div class="dia-detalhe-lista">' +
      revsFeitas.map(function (r) {
        const t = D.topicoPorId(state, r.topicoId);
        const d = D.disciplinaDoTopico(state, r.topicoId);
        const cor = d ? d.cor : '#9A9DA3';
        const pctTxt = r.resultadoPct != null ? ' · ' + r.resultadoPct + '%' : '';
        const duracaoTxt = D.formatarMin(D.duracaoRevisaoConcluidaMin(state, r));
        return '<div class="dia-detalhe-item dia-detalhe-rev feito" style="--disc-cor:' + esc(cor) + '">' +
          '<span class="dia-detalhe-cor" style="background:' + esc(cor) + '"></span>' +
          '<span class="dia-detalhe-info"><span class="dia-detalhe-disc">' + (t ? esc(t.nome) : 'Revisão') + ' ✓</span>' +
          '<span class="dia-detalhe-sub">' + duracaoTxt + ' · revisão ' + esc(rotuloTipoRevisao(r.tipo)) + ' concluída' + pctTxt + '</span></span></div>';
      }).join('') + '</div></div>';
    const ymd = dataISO.split('-').map(Number);
    const diaSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][new Date(ymd[0], ymd[1] - 1, ymd[2]).getDay()];
    const listaHtml = blocos.length === 0
      ? '<div class="estado-vazio" style="padding:1.5rem 0"><span class="bolha bolha-pendente"></span><strong>Nenhum bloco neste dia</strong>Adicione um bloco de estudo abaixo.</div>'
      : '<div class="dia-detalhe-lista">' + blocos.map(function (b) {
          const d = D.disciplinaPorId(state, b.disciplinaId);
          const t = b.topicoId ? D.topicoPorId(state, b.topicoId) : null;
          const concluido = blocoAgendaConcluido(b);
          const tipo = b.obs === 'questoes' ? 'Questões' : b.obs === 'revisao' ? 'Revisão' : b.obs === 'teoria' ? 'Teoria' : (b.obs || '');
          const tempoTxt = blocoParcial(b)
            ? 'faltam ' + D.formatarMin(blocoRestanteMin(b)) + ' de ' + D.formatarMin(b.duracaoMin || 0)
            : D.formatarMin(b.duracaoMin || 0);
          return '<button class="dia-detalhe-item' + (concluido ? ' feito' : '') + '" data-dia-bloco="' + esc(b.id) + '" style="--disc-cor:' + esc(d ? d.cor : '#9A9DA3') + '">' +
            '<span class="dia-detalhe-cor" style="background:' + esc(d ? d.cor : '#9A9DA3') + '"></span>' +
            '<span class="dia-detalhe-info"><span class="dia-detalhe-disc">' + esc(d ? d.nome : b.disciplinaId) + (concluido ? ' ✓' : '') + '</span>' +
            '<span class="dia-detalhe-sub">' + tempoTxt + (tipo ? ' · ' + esc(tipo) : '') + (t ? ' · ' + esc(t.nome) : '') + '</span></span>' +
            '<span class="dia-detalhe-seta">›</span></button>';
        }).join('') + '</div>';
    const m = abrirModal(
      '<div class="dia-detalhe-cab"><div><h3>' + D.formatarDataBR(dataISO) + '</h3>' +
      '<p class="sub">' + diaSemana + (blocos.length || revs.length || sims.length ? ' · ' + blocos.length + ' blocos · ' + revs.length + ' revisões' + (sims.length ? ' · ' + sims.length + ' simulados' : '') + ' · ' + D.formatarMin(totalMin) : ' · dia livre') + '</p></div></div>' +
      listaHtml + revsHtml + revsFeitasHtml + simsHtml +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="dd-semana">Abrir semana</button>' +
      '<button type="button" class="botao" id="dd-add">+ Adicionar bloco</button></div>'
    );
    m.querySelectorAll('[data-dia-bloco]').forEach(function (el) {
      el.addEventListener('click', function () { fecharModal(); abrirBlocoAgenda(el.getAttribute('data-dia-bloco')); });
    });
    m.querySelectorAll('[data-dia-sim]').forEach(function (el) {
      el.addEventListener('click', function () { fecharModal(); location.hash = '#simulados'; });
    });
    m.querySelectorAll('[data-mover-rev]').forEach(function (el) {
      el.addEventListener('click', function () { fecharModal(); abrirMoverRevisao(el.getAttribute('data-mover-rev')); });
    });
    m.querySelector('#dd-add').addEventListener('click', function () { fecharModal(); abrirNovoBlocoAgenda(dataISO); });
    m.querySelector('#dd-semana').addEventListener('click', function () {
      fecharModal();
      agendaRef = D.segundaDaSemana(dataISO);
      agendaModo = 'semana';
      render();
    });
  }

  // RN12 — modal de cobertura vs. prova. Aparece no máximo 1x por semana ao abrir
  // o planejamento, e só quando há tópicos que não devem ser vistos a tempo.
  function talvezAlertarCobertura() {
    if (modoDemo || !state.plano) return;
    const semana = D.segundaDaSemana(D.hojeISO());
    state.config = state.config || {};
    if (state.config.alertaCoberturaSemana === semana) return; // já mostrado nesta semana
    const raizModal = document.getElementById('modal-raiz');
    if (raizModal && raizModal.children.length) return; // outro modal aberto: tenta na próxima
    const alerta = D.alertaCobertura(state, D.hojeISO(), { minutosSemana: totalMinutosRotina(rotinaEstudosAtual()) });
    if (!alerta || !alerta.topicos.length) return;
    state.config.alertaCoberturaSemana = semana; // trava: no máximo 1x/semana
    salvar();
    abrirModalCobertura(alerta);
  }

  function abrirModalCobertura(alerta) {
    const top = alerta.topicos;
    const MAX = 12;
    const plural = top.length > 1;
    const linhas = top.slice(0, MAX).map(function (t) {
      return '<li class="cob-item"><span class="cob-disc">' + esc(t.disciplina) + '</span>' +
        '<span class="cob-top">' + esc(t.nome) + '</span>' +
        '<span class="cob-inc" title="Incidência estimada">' + (Math.round((t.incidencia || 0) * 10) / 10) + '%</span></li>';
    }).join('');
    const extra = top.length > MAX ? '<p class="sub cob-extra">+ ' + (top.length - MAX) + ' outros tópicos.</p>' : '';
    let cabecalho, acoes;
    if (alerta.modo === 'ciclo') {
      const vr = alerta.voltasRestantes;
      // Na reta final o app prega consolidar, não abrir matéria nova: adapta o tom
      // e remove o "Adicionar ao ciclo" para não contradizer o modo reta final.
      if (D.retaFinalInfo(state, D.hojeISO()).ativa) {
        cabecalho = '<div class="dialogo-icone" aria-hidden="true">🏁</div>' +
          '<h3>' + top.length + ' tópico' + (plural ? 's' : '') + ' não deve' + (plural ? 'm' : '') + ' ser visto' + (plural ? 's' : '') + ' a tempo</h3>' +
          '<p class="sub dialogo-msg">Você está na reta final — é esperado deixar os de menor incidência de fora. ' +
          'Em vez de abrir matéria nova, foque em consolidar o que já viu (questões, simulados e revisão).</p>';
        acoes = '<button type="button" data-cob="fechar">Entendi</button>';
      } else {
        cabecalho = '<div class="dialogo-icone" aria-hidden="true">🔴</div>' +
          '<h3>' + top.length + ' tópico' + (plural ? 's' : '') + ' pode' + (plural ? 'm' : '') + ' ficar de fora do ciclo</h3>' +
          '<p class="sub dialogo-msg">No seu ritmo restam ~' + vr + ' volta' + (vr > 1 ? 's' : '') +
          ' até a prova. Estes tópicos (de menor incidência) não devem ser alcançados pelo ciclo. ' +
          'Você decide: adicioná-los agora ou seguir focado no que mais cai.</p>';
        acoes = '<button type="button" class="botao-quieto" data-cob="fechar">Manter como está</button>' +
          '<button type="button" data-cob="addciclo">Adicionar ao ciclo</button>';
      }
    } else {
      const sa = alerta.semanasApos;
      cabecalho = '<div class="dialogo-icone" aria-hidden="true">🔴</div>' +
        '<h3>O plano termina ~' + sa + ' semana' + (sa > 1 ? 's' : '') + ' depois da prova</h3>' +
        '<p class="sub dialogo-msg">No seu ritmo, estes tópicos estão agendados para depois da data da prova e não serão vistos a tempo. ' +
        'Considere priorizá-los — estão ordenados pela incidência cadastrada.</p>';
      acoes = '<button type="button" data-cob="fechar">Entendi</button>';
    }
    const m = abrirModal('<div class="cobertura-modal">' + cabecalho +
      '<ul class="cob-lista">' + linhas + '</ul>' + extra +
      '<div class="modal-acoes">' + acoes + '</div></div>');
    m.querySelectorAll('[data-cob="fechar"]').forEach(function (b) { b.addEventListener('click', fecharModal); });
    const add = m.querySelector('[data-cob="addciclo"]');
    if (add) add.addEventListener('click', function () {
      const n = D.adicionarTopicosAoCiclo(state.plano.ciclo, alerta.topicos);
      salvar();
      fecharModal();
      toast(n > 0 ? (n + ' tópico' + (n > 1 ? 's' : '') + ' adicionado' + (n > 1 ? 's' : '') + ' ao ciclo.') : 'Nada a adicionar.', n > 0 ? 'sucesso' : 'erro');
      render();
    });
  }

  function ligarPlanejamento(raiz) {
    setTimeout(talvezAlertarCobertura, 0);
    setTimeout(talvezAvisarProvaPassada, 0);
    const btnEnf = raiz.querySelector('#enf-ajustar');
    if (btnEnf) btnEnf.addEventListener('click', abrirAjusteEnfase);
    // alternar método (cronograma ↔ ciclo)
    raiz.querySelectorAll('[data-modo-plan]').forEach(function (b) {
      b.addEventListener('click', function () {
        const novo = b.getAttribute('data-modo-plan');
        if (!state.plano || state.plano.modoPlanejamento === novo) return;
        const msg = novo === 'ciclo'
          ? 'O calendario gerado pelo cronograma sera removido e a tela Hoje passara a seguir a fila do ciclo. Blocos manuais continuam guardados.'
          : 'A fila do ciclo sera desativada e um novo cronograma flexivel podera preencher sua agenda.';
        confirmar({ titulo: 'Trocar metodo de estudo?', mensagem: msg, confirmar: 'Trocar metodo', icone: '⚠️' }).then(function (ok) {
          if (!ok) return;
          if (novo === 'ciclo') {
            limparAgendaGeradaPlano(state.planoAtivoId);
            limparCronogramasPlanoAtivo();
            state.plano.modoPlanejamento = 'ciclo';
            salvar(); render();
          } else {
            // Volta para o cronograma flexível: REGENERA automaticamente (antes
            // ficava vazio até a pessoa clicar em "Recalcular plano"). Preserva o
            // ritmo/horas do plano quando houver.
            const r = state.plano.ritmos && state.plano.ritmoAtivo ? state.plano.ritmos[state.plano.ritmoAtivo] : null;
            state.plano.ciclo = { blocos: [], volta: 1 };
            const gerou = aplicarPlanoDuracaoAoAtivo(r && r.meses, r && r.h_semana, true);
            if (!gerou) { state.plano.modoPlanejamento = 'cronograma'; salvar(); }
            const cron = D.cronogramaAtivo(state);
            if (cron.length) { agendaRef = cron[0].inicio; agendaModo = 'semana'; }
            render();
            toast(gerou ? 'Cronograma flexível gerado' : 'Método alterado — adicione disciplinas para gerar o cronograma', gerou ? 'sucesso' : 'erro');
          }
        });
      });
    });
    ligarCiclo(raiz);

    const editais = raiz.querySelector('#pl-editais');
    if (editais) editais.addEventListener('click', abrirEditaisDisponiveis);
    const novaDiscCard = raiz.querySelector('#pl-nova-disc-card');
    if (novaDiscCard) novaDiscCard.addEventListener('click', abrirNovaDisciplina);
    const gerenciarDisc = raiz.querySelector('#pl-gerenciar-disc');
    if (gerenciarDisc) gerenciarDisc.addEventListener('click', abrirGerenciarDisciplinas);
    const criarDisc = raiz.querySelector('#pl-criar-disc');
    if (criarDisc) criarDisc.addEventListener('click', abrirNovaDisciplina);
    ['#pl-em-branco', '#pl-em-branco-2', '#pl-em-branco-vazio'].forEach(function (sel) {
      const b = raiz.querySelector(sel);
      if (b) b.addEventListener('click', criarPlanoManualComPrompt);
    });

    const ritmo = raiz.querySelector('#pl-ritmo');
    if (ritmo) ritmo.addEventListener('change', function () {
      state.plano.ritmoAtivo = ritmo.value;
      salvar(); render();
      toast('Ritmo ativo alterado', 'sucesso');
    });
    const gerarRitmos = raiz.querySelector('#pl-gerar-ritmos');
    if (gerarRitmos) gerarRitmos.addEventListener('click', function () {
      abrirGerarPlanoComRotina();
    });
    const ajustarRotina = raiz.querySelector('#pl-ajustar-rotina');
    if (ajustarRotina) ajustarRotina.addEventListener('click', function () { abrirGerarPlanoComRotina(); });
    const ajustarPerfil = raiz.querySelector('#pl-ajustar-perfil');
    if (ajustarPerfil) ajustarPerfil.addEventListener('click', function () { abrirPerfilPlano(state.planoAtivoId); });

    // ações do card "Plano atual": Edital · Perfil · Excluir
    const acaoEditar = raiz.querySelector('#pl-acao-editar');
    if (acaoEditar) acaoEditar.addEventListener('click', function () {
      // reabre o assistente já preenchido com as escolhas atuais (sem novoPlanoId,
      // então cancelar/fechar NÃO apaga o plano existente).
      abrirGerarPlanoComRotina();
    });
    const acaoEdital = raiz.querySelector('#pl-acao-edital');
    if (acaoEdital) acaoEdital.addEventListener('click', function () {
      if (location.hash !== '#edital') location.hash = '#edital'; else render();
    });
    const acaoPerfil = raiz.querySelector('#pl-acao-perfil');
    if (acaoPerfil) acaoPerfil.addEventListener('click', function () { abrirPerfilPlano(state.planoAtivoId); });
    const acaoExcluir = raiz.querySelector('#pl-acao-excluir');
    if (acaoExcluir) acaoExcluir.addEventListener('click', async function () {
      if (state.planoAtivoId) await excluirPlano(state.planoAtivoId, true);
    });
    const retaAtivar = raiz.querySelector('#pl-reta-ativar');
    if (retaAtivar) retaAtivar.addEventListener('click', abrirModoRetaFinal);
    const retaDesativar = raiz.querySelector('#pl-reta-desativar');
    if (retaDesativar) retaDesativar.addEventListener('click', function () {
      if (state.plano) { delete state.plano.modoRetaFinal; salvar(); render(); toast('Modo reta final desativado', 'sucesso'); }
    });
    const aprofDesativar = raiz.querySelector('#pl-aprof-desativar');
    if (aprofDesativar) aprofDesativar.addEventListener('click', function () {
      if (state.plano) { delete state.plano.modoAprofundamento; salvar(); render(); toast('Modo aprofundamento desativado', 'sucesso'); }
    });
    const atualizarEd = raiz.querySelector('#pl-atualizar-edital');
    if (atualizarEd) atualizarEd.addEventListener('click', function () {
      confirmar({ titulo: 'Atualizar plano pelo edital?', mensagem: 'Seu progresso é mantido. Tópicos novos do edital entram no plano e os removidos ficam marcados. Depois, recalcule o plano para encaixar tudo no cronograma.', confirmar: 'Atualizar', icone: '📣' }).then(function (ok) {
        if (ok) atualizarPlanoAtivoDoEdital();
      });
    });
    // navegação do calendário (semana/mês)
    const ant = raiz.querySelector('#pl-ant');
    if (ant) ant.addEventListener('click', function () {
      if (agendaModo === 'semana') agendaRef = D.addDias(agendaRef, -7);
      else {
        const [a, m] = mesRef.split('-').map(Number);
        mesRef = (m === 1 ? (a - 1) + '-12' : a + '-' + String(m - 1).padStart(2, '0'));
      }
      render();
    });
    const prox = raiz.querySelector('#pl-prox');
    if (prox) prox.addEventListener('click', function () {
      if (agendaModo === 'semana') agendaRef = D.addDias(agendaRef, 7);
      else {
        const [a, m] = mesRef.split('-').map(Number);
        mesRef = (m === 12 ? (a + 1) + '-01' : a + '-' + String(m + 1).padStart(2, '0'));
      }
      render();
    });
    const irHoje = raiz.querySelector('#pl-hoje');
    if (irHoje) irHoje.addEventListener('click', function () {
      agendaRef = D.segundaDaSemana(D.hojeISO());
      mesRef = D.hojeISO().slice(0, 7);
      render();
    });
    raiz.querySelectorAll('[data-modo-ag]').forEach(function (b) {
      b.addEventListener('click', function () { agendaModo = b.getAttribute('data-modo-ag'); render(); });
    });

    // Recolher/expandir o card "Personalize" (relevante no celular). Alterna a
    // classe direto no DOM (sem re-render) e guarda a escolha para o próximo render.
    const paletaToggle = raiz.querySelector('[data-paleta-toggle]');
    if (paletaToggle) paletaToggle.addEventListener('click', function () {
      const card = paletaToggle.closest('.planejamento-disciplinas-card');
      if (!card) return;
      paletaExpandida = card.classList.toggle('paleta-aberta');
      paletaToggle.setAttribute('aria-expanded', paletaExpandida ? 'true' : 'false');
    });

    const paletaVerMais = raiz.querySelector('[data-paleta-vermais]');
    if (paletaVerMais) paletaVerMais.addEventListener('click', function () {
      const paleta = paletaVerMais.closest('.paleta-disc');
      if (!paleta) return;
      const aberto = paleta.classList.toggle('expandido');
      paletaVerMais.setAttribute('aria-expanded', aberto ? 'true' : 'false');
      paletaVerMais.textContent = aberto ? '−' : ('+' + paleta.querySelectorAll('.chip-disc-extra').length);
    });

    raiz.querySelectorAll('[data-regra-remover]').forEach(function (b) {
      b.addEventListener('click', function () { removerRegraRecorrente(b.getAttribute('data-regra-remover')); });
    });
    const gerenciarPausadas = raiz.querySelector('#pl-gerenciar-pausadas');
    if (gerenciarPausadas) gerenciarPausadas.addEventListener('click', abrirGerenciarDisciplinasPausadas);
    const desfazerAjuste = raiz.querySelector('#pl-desfazer-ajuste');
    if (desfazerAjuste) desfazerAjuste.addEventListener('click', desfazerUltimoAjusteAgenda);

    // chips: arrastar para um dia ou tocar para agendar hoje
    raiz.querySelectorAll('[data-chip]').forEach(function (chip) {
      chip.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', 'nova|' + chip.getAttribute('data-chip'));
        e.dataTransfer.effectAllowed = 'copy';
      });
      chip.addEventListener('click', function () {
        abrirNovoBlocoAgenda(D.hojeISO(), chip.getAttribute('data-chip'));
      });
    });

    // blocos existentes: clicar edita, arrastar move/reordena. Cada bloco também é
    // alvo de soltura: soltar sobre ele insere a disciplina ANTES dele (reordenar).
    raiz.querySelectorAll('[data-revisao]').forEach(function (el) {
      const abrir = function () { abrirAcoesRevisao(el.getAttribute('data-revisao')); };
      el.addEventListener('click', abrir);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
    });
    raiz.querySelectorAll('[data-revisao-feita]').forEach(function (el) {
      const abrir = function () { abrirDetalhesRevisaoConcluida(el.getAttribute('data-revisao-feita')); };
      el.addEventListener('click', abrir);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
    });
    raiz.querySelectorAll('[data-bloco-menu]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        abrirMenuAcoesBloco(btn.getAttribute('data-bloco-menu'));
      });
      btn.addEventListener('keydown', function (e) { e.stopPropagation(); });
    });
    raiz.querySelectorAll('[data-bloco]').forEach(function (el) {
      el.addEventListener('click', function () { abrirBlocoAgenda(el.getAttribute('data-bloco')); });
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirBlocoAgenda(el.getAttribute('data-bloco')); } });
      el.addEventListener('dragstart', function (e) {
        e.stopPropagation();
        e.dataTransfer.setData('text/plain', 'mover|' + el.getAttribute('data-bloco'));
        e.dataTransfer.effectAllowed = 'move';
      });
      const diaBloco = el.getAttribute('data-pos-dia');
      if (diaBloco) {
        el.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); el.classList.add('drop-antes'); });
        el.addEventListener('dragleave', function () { el.classList.remove('drop-antes'); });
        el.addEventListener('drop', function (e) {
          e.preventDefault(); e.stopPropagation();
          el.classList.remove('drop-antes');
          moverOuCriarBlocoNoDia(e.dataTransfer.getData('text/plain'), diaBloco, el.getAttribute('data-bloco'));
        });
      }
    });

    raiz.querySelectorAll('[data-add-dia]').forEach(function (b) {
      b.addEventListener('click', function () { abrirNovoBlocoAgenda(b.getAttribute('data-add-dia')); });
    });

    // alvos de soltura (dias do ciclo) — drag & drop nativo (mouse/desktop)
    raiz.querySelectorAll('[data-dia]').forEach(function (cel) {
      cel.addEventListener('dragover', function (e) { e.preventDefault(); cel.classList.add('drop-alvo'); });
      cel.addEventListener('dragleave', function () { cel.classList.remove('drop-alvo'); });
      cel.addEventListener('drop', function (e) {
        e.preventDefault();
        cel.classList.remove('drop-alvo');
        moverOuCriarBlocoNoDia(e.dataTransfer.getData('text/plain'), cel.getAttribute('data-dia'));
      });
    });

    // visão mensal: clicar num dia abre a tela de detalhes daquele dia
    raiz.querySelectorAll('[data-dia-detalhe]').forEach(function (cel) {
      const abrir = function () { abrirDetalhesDia(cel.getAttribute('data-dia-detalhe')); };
      cel.addEventListener('click', abrir);
      cel.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); abrir(); } });
    });

    // arrastar e soltar por toque (mobile), sem quebrar o scroll nativo
    ligarDragTouch(raiz);
  }

  // ação compartilhada por drop nativo e por toque.
  // alvoId (opcional): id do bloco antes do qual inserir — permite reordenar
  // dentro do mesmo dia e posicionar a disciplina solta entre blocos.
  function moverOuCriarBlocoNoDia(dado, dia, alvoId) {
    if (!dado || !dia || alvoId === dado.slice(dado.indexOf('|') + 1)) return; // soltar sobre si mesmo
    const ehNova = dado.indexOf('nova|') === 0;
    // Mover um bloco RECORRENTE (gerado) para outro DIA DA SEMANA: oferece o
    // alcance recorrente (só esta semana / próximas / todas), como na troca de
    // disciplina. Reordenar dentro do mesmo dia ou mover bloco manual segue direto.
    if (!ehNova) {
      const blocoMov = state.agenda.find(function (x) { return x.id === dado.slice(dado.indexOf('|') + 1); });
      const mudaDiaSemana = blocoMov && blocoMov.gerado && !blocoMov.feito &&
        D.diaSemanaISO(blocoMov.data) !== D.diaSemanaISO(dia);
      if (mudaDiaSemana) {
        const origem = blocoMov.data, discMov = blocoMov.disciplinaId;
        abrirAlcanceRecorrente({ diaNome: nomeDiaSemana(origem) }, function (alc) {
          if (alc === 'semana') {
            if (reordenarBlocoNoDia(dado, dia, alvoId)) { salvar(); render(); toast('Bloco movido só nesta semana', 'sucesso'); }
          } else {
            criarRegraMoverRecorrente(origem, discMov, D.diaSemanaISO(dia), alc);
          }
        });
        return;
      }
    }
    if (reordenarBlocoNoDia(dado, dia, alvoId)) {
      salvar(); render();
      toast(ehNova ? 'Bloco de 1h adicionado — toque nele para ajustar' : 'Bloco reposicionado', 'sucesso');
    }
  }

  // Cria/atualiza a regra de MOVER um estudo recorrente para outro dia da semana.
  function criarRegraMoverRecorrente(dataOrigem, discId, paraDia, alc) {
    if (!state.config.regrasAgenda) state.config.regrasAgenda = [];
    const dia = D.diaSemanaISO(dataOrigem);
    if (dia === paraDia) return;
    const desde = alc === 'todos' ? null : D.segundaDaSemana(dataOrigem);
    state.config.regrasAgenda = state.config.regrasAgenda.filter(function (r) {
      return !(r.planoId === state.planoAtivoId && r.diaSemana === dia && r.de === discId && (r.desde || null) === (desde || null) && r.paraDia != null);
    });
    state.config.regrasAgenda.push({
      id: window.Store.novoId('rga'), planoId: state.planoAtivoId,
      diaSemana: dia, de: discId, paraDia: paraDia, desde: desde
    });
    regenerarAgendaFuturas();
    salvar(); fecharModal(); render();
    const d = D.disciplinaPorId(state, discId);
    toast((d ? d.nome : discId) + ' movido de ' + nomeDiaSemanaIdx(dia) + ' para ' + nomeDiaSemanaIdx(paraDia), 'sucesso');
  }

  // ---- Ciclo de estudos: eventos e edição da fila ----
  function ligarCiclo(raiz) {
    const gerar = raiz.querySelector('#ciclo-gerar');
    if (gerar) gerar.addEventListener('click', gerarCicloSugerido);
    const add = raiz.querySelector('#ciclo-add');
    if (add) add.addEventListener('click', function () { abrirEditarCiclo(null); });
    const reiniciar = raiz.querySelector('#ciclo-reiniciar');
    if (reiniciar) reiniciar.addEventListener('click', reiniciarVoltaCiclo);

    raiz.querySelectorAll('[data-ciclo-mover]').forEach(function (b) {
      b.addEventListener('click', function () {
        moverBlocoCiclo(b.getAttribute('data-id'), b.getAttribute('data-ciclo-mover'));
      });
    });
    raiz.querySelectorAll('[data-ciclo-editar]').forEach(function (b) {
      b.addEventListener('click', function () { abrirEditarCiclo(b.getAttribute('data-ciclo-editar')); });
    });
    raiz.querySelectorAll('[data-ciclo-remover]').forEach(function (b) {
      b.addEventListener('click', function () { removerBlocoCiclo(b.getAttribute('data-ciclo-remover')); });
    });

    // arrastar para reordenar (desktop); ▲▼ cobrem mobile/acessibilidade
    raiz.querySelectorAll('[data-ciclo-bloco]').forEach(function (el) {
      el.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', el.getAttribute('data-ciclo-bloco'));
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragover', function (e) { e.preventDefault(); el.classList.add('drop-antes'); });
      el.addEventListener('dragleave', function () { el.classList.remove('drop-antes'); });
      el.addEventListener('drop', function (e) {
        e.preventDefault();
        el.classList.remove('drop-antes');
        reordenarCiclo(e.dataTransfer.getData('text/plain'), el.getAttribute('data-ciclo-bloco'));
      });
    });
  }

  function gerarCicloSugerido() {
    const ciclo = state.plano.ciclo || (state.plano.ciclo = { blocos: [], volta: 1 });
    function gerar() {
      const rotina = rotinaEstudosAtual();
      const min = totalMinutosRotina(rotina);
      const blocos = D.sugerirCiclo(state, {
        minutosSemana: min > 0 ? min : 600,
        minBloco: rotina.minBloco,
        maxBloco: rotina.maxBloco,
        ordemAtaque: state.plano.ordemAtaque || 'incidencia'
      });
      if (blocos.length === 0) { toast('Adicione disciplinas antes de gerar o ciclo.', 'erro'); return; }
      limparAgendaGeradaPlano(state.planoAtivoId);
      limparCronogramasPlanoAtivo();
      state.plano.modoPlanejamento = 'ciclo';
      ciclo.blocos = blocos;
      ciclo.volta = 1;
      salvar(); render();
      toast('Ciclo gerado pelas suas matérias — ajuste à vontade.', 'sucesso');
    }
    if (ciclo.blocos && ciclo.blocos.length > 0) {
      confirmar({
        titulo: 'Regerar o ciclo?',
        mensagem: 'Isso substitui a fila atual e o progresso da volta por uma nova sugestão.',
        confirmar: 'Regerar', perigo: true
      }).then(function (ok) { if (ok) gerar(); });
    } else {
      gerar();
    }
  }

  function reiniciarVoltaCiclo() {
    const ciclo = state.plano.ciclo;
    if (!ciclo || !ciclo.blocos || ciclo.blocos.length === 0) return;
    ciclo.blocos.forEach(function (b) { b.feitoMin = 0; });
    ciclo.volta = 1;
    salvar(); render();
    toast('Volta reiniciada — bora começar de novo!', 'sucesso');
  }

  function moverBlocoCiclo(id, dir) {
    const blocos = state.plano.ciclo.blocos;
    const i = blocos.findIndex(function (b) { return b.id === id; });
    if (i < 0) return;
    const j = dir === 'cima' ? i - 1 : i + 1;
    if (j < 0 || j >= blocos.length) return;
    const tmp = blocos[i]; blocos[i] = blocos[j]; blocos[j] = tmp;
    salvar(); render();
  }

  function reordenarCiclo(idArrastado, idAlvo) {
    if (!idArrastado || idArrastado === idAlvo) return;
    const blocos = state.plano.ciclo.blocos;
    const de = blocos.findIndex(function (b) { return b.id === idArrastado; });
    if (de < 0) return;
    const item = blocos.splice(de, 1)[0];
    const alvo = blocos.findIndex(function (b) { return b.id === idAlvo; });
    blocos.splice(alvo < 0 ? blocos.length : alvo, 0, item);
    salvar(); render();
  }

  function removerBlocoCiclo(id) {
    const blocos = state.plano.ciclo.blocos;
    const i = blocos.findIndex(function (b) { return b.id === id; });
    if (i < 0) return;
    blocos.splice(i, 1);
    salvar(); render();
    toast('Matéria removida do ciclo', 'sucesso');
  }

  // Modal de adicionar (b === null) ou editar um bloco do ciclo.
  function abrirEditarCiclo(id) {
    if (state.disciplinas.length === 0) { abrirNovaDisciplina(); return; }
    const ciclo = state.plano.ciclo || (state.plano.ciclo = { blocos: [], volta: 1 });
    const b = id ? ciclo.blocos.find(function (x) { return x.id === id; }) : null;
    const discIni = b ? b.disciplinaId : state.disciplinas.filter(function (d) { return d.id !== 'ORF'; })[0].id;
    const optsDisc = state.disciplinas.filter(function (d) { return d.id !== 'ORF'; }).map(function (d) {
      return '<option value="' + esc(d.id) + '"' + (d.id === discIni ? ' selected' : '') + '>' + esc(d.id + ' — ' + d.nome) + '</option>';
    }).join('');
    const m = abrirModal(
      '<h3>' + (b ? 'Editar bloco do ciclo' : 'Adicionar ao ciclo') + '</h3>' +
      '<form id="form-ciclo">' +
      '<label for="cic-disc">Disciplina</label><select id="cic-disc">' + optsDisc + '</select>' +
      cabecalhoTopicoEditavel('cic-topico', 'Tópico-alvo (opcional)', 'cic-editar-topico') +
      '<select id="cic-topico"></select>' +
      '<label for="cic-min">Meta de tempo (min)</label><input id="cic-min" type="number" min="10" max="240" step="5" value="' + (b ? (b.metaMin || 60) : 60) + '">' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="cic-cancelar">Cancelar</button>' +
      '<button type="submit">' + (b ? 'Salvar' : 'Adicionar') + '</button></div></form>'
    );
    const selDisc = m.querySelector('#cic-disc');
    const selTop = m.querySelector('#cic-topico');
    function preencher() {
      const d = D.disciplinaPorId(state, selDisc.value);
      selTop.innerHTML = opcoesTopicosSelect(d, b ? b.topicoId : null);
      selTop.dataset.prevTop = selTop.value;
    }
    preencher();
    selDisc.addEventListener('change', preencher);
    const atualizarEditar = ligarEditarTopicoSelect(selDisc, selTop, m.querySelector('#cic-editar-topico'));
    ligarCriarTopicoSelect(selDisc, selTop, atualizarEditar);
    m.querySelector('#cic-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#form-ciclo').addEventListener('submit', function (e) {
      e.preventDefault();
      const metaMin = Math.max(10, parseInt(m.querySelector('#cic-min').value, 10) || 60);
      if (b) {
        b.disciplinaId = selDisc.value;
        b.topicoId = selTop.value || null;
        b.metaMin = metaMin;
        if (b.feitoMin > metaMin) b.feitoMin = metaMin;
      } else {
        ciclo.blocos.push({
          id: window.Store.novoId('blc'), disciplinaId: selDisc.value,
          topicoId: selTop.value || null, metaMin: metaMin, feitoMin: 0
        });
      }
      salvar(); fecharModal(); render();
      toast(b ? 'Bloco atualizado' : 'Matéria adicionada ao ciclo', 'sucesso');
    });
  }

  // Drag and drop por toque: long-press inicia o arrasto; antes disso o scroll
  // nativo continua funcionando. Um "fantasma" segue o dedo e o dia sob ele é o alvo.
  function ligarDragTouch(raiz) {
    raiz.querySelectorAll('[data-bloco], [data-chip]').forEach(function (el) {
      let timer = null, ativo = false, clone = null, alvo = null, payload = '', startX = 0, startY = 0;

      function payloadDe() {
        return el.hasAttribute('data-bloco')
          ? 'mover|' + el.getAttribute('data-bloco')
          : 'nova|' + el.getAttribute('data-chip');
      }
      let alvoBloco = null, alvoBlocoId = null;
      function limpar() {
        if (timer) { clearTimeout(timer); timer = null; }
        if (clone) { clone.remove(); clone = null; }
        if (alvo) { alvo.classList.remove('drop-alvo'); alvo = null; }
        if (alvoBloco) { alvoBloco.classList.remove('drop-antes'); alvoBloco = null; }
        alvoBlocoId = null;
        ativo = false;
        document.body.classList.remove('arrastando-toque');
      }
      function iniciar(t) {
        ativo = true;
        payload = payloadDe();
        document.body.classList.add('arrastando-toque');
        const r = el.getBoundingClientRect();
        clone = el.cloneNode(true);
        clone.classList.add('drag-fantasma');
        clone.style.width = r.width + 'px';
        clone.style.left = (t.clientX - r.width / 2) + 'px';
        clone.style.top = (t.clientY - r.height / 2) + 'px';
        document.body.appendChild(clone);
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
      }

      el.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        startX = t.clientX; startY = t.clientY;
        timer = setTimeout(function () { timer = null; iniciar(t); }, 200);
      }, { passive: true });

      el.addEventListener('touchmove', function (e) {
        const t = e.touches[0];
        if (!ativo) {
          // movimento antes do long-press = scroll → cancela o arrasto e deixa rolar
          if (timer && (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10)) {
            clearTimeout(timer); timer = null;
          }
          return;
        }
        e.preventDefault(); // segura o scroll apenas durante o arrasto
        clone.style.left = (t.clientX - clone.offsetWidth / 2) + 'px';
        clone.style.top = (t.clientY - clone.offsetHeight / 2) + 'px';
        const sob = document.elementFromPoint(t.clientX, t.clientY);
        const dia = sob ? sob.closest('[data-dia]') : null;
        if (dia !== alvo) {
          if (alvo) alvo.classList.remove('drop-alvo');
          alvo = dia;
          if (alvo) alvo.classList.add('drop-alvo');
        }
        // bloco sob o dedo (exceto o próprio arrastado) = inserir antes dele
        const bloco = sob ? sob.closest('[data-bloco]') : null;
        const bAlvo = (bloco && bloco !== el) ? bloco : null;
        if (bAlvo !== alvoBloco) {
          if (alvoBloco) alvoBloco.classList.remove('drop-antes');
          alvoBloco = bAlvo;
          alvoBlocoId = bAlvo ? bAlvo.getAttribute('data-bloco') : null;
          if (alvoBloco) alvoBloco.classList.add('drop-antes');
        }
      }, { passive: false });

      el.addEventListener('touchend', function () {
        if (ativo && alvo) {
          const dia = alvo.getAttribute('data-dia');
          const idAlvo = alvoBlocoId;
          limpar();
          moverOuCriarBlocoNoDia(payload, dia, idAlvo);
        } else {
          limpar();
        }
      });
      el.addEventListener('touchcancel', limpar);
    });
  }

  // ---------------- TELA: Planos (multiconcurso + perfil do aluno) ----------------
  function multDificuldade(d) {
    return d.dificuldade === 'facil' ? 0.75 : d.dificuldade === 'dificil' ? 1.4 : 1;
  }

  // Versão suavizada usada só na ORDEM do cronograma (qual matéria começa antes e
  // sua prioridade na semana). Mantém uma leve dianteira para as difíceis sem
  // deixá-las monopolizar o início — o tempo extra real vem das horas
  // (multDificuldade em distribuicaoSemanal), não da ordem.
  function multDificuldadeOrdem(d) {
    return d.dificuldade === 'facil' ? 0.9 : d.dificuldade === 'dificil' ? 1.15 : 1;
  }

  // distribuição de horas da semana corrente: peso do concurso × dificuldade do aluno
  function distribuicaoSemanal(inicioReferencia) {
    if (!state.plano) return null;
    const hoje = D.hojeISO();
    const ref = inicioReferencia || agendaRef || D.segundaDaSemana(hoje);
    const cron = state.cronogramas && state.plano ? (state.cronogramas[state.plano.ritmoAtivo || 'sustentavel'] || []) : [];
    let sem = cron.find(function (s) { return ref >= s.inicio && ref < D.addDias(s.inicio, 7); });
    if (!sem && cron.length > 0 && ref < cron[0].inicio) sem = cron[0];
    if (!sem) sem = D.semanaCorrente(state, hoje);
    if (!sem || sem.futura || sem.encerrado) return null;
    const meta = D.metaSemanal(state, hoje);
    const ritmo = state.plano.ritmoAtivo || 'sustentavel';
    const r = state.plano.ritmos && state.plano.ritmos[ritmo];
    const hAlvo = r && (r.h_semana || r.h_semana_exigidas) ? (r.h_semana || r.h_semana_exigidas) : (meta.horasAlvo > 0 ? meta.horasAlvo : 20);

    const porDisc = {};
    sem.blocos.forEach(function (b) {
      const disciplina = D.disciplinaPorId(state, b.disciplina);
      if (!D.disciplinaAtivaPlanejamento(disciplina)) return;
      const e = porDisc[b.disciplina] = porDisc[b.disciplina] || { teoria: false, blocos: [] };
      if (b.tipo === 'teoria') e.teoria = true;
      e.blocos.push(b);
    });
    let somaW = 0;
    const itens = [];
    Object.keys(porDisc).forEach(function (id) {
      const d = D.disciplinaPorId(state, id);
      if (!d) return;
      const w = (d.peso || 1) * multDificuldade(d) * (porDisc[id].teoria ? 1.6 : 0.6) *
        D.fatorDisciplinaCombinada(state.plano, d, hoje);
      somaW += w;
      itens.push({ disciplina: d, w, teoria: porDisc[id].teoria, blocos: porDisc[id].blocos });
    });
    if (somaW === 0) return null;
    itens.forEach(function (i) {
      i.horas = Math.max(0.5, Math.round((hAlvo * i.w / somaW) * 4) / 4);
    });
    itens.sort(function (a, b) { return b.horas - a.horas; });
    return { semana: sem, hAlvo, itens };
  }

  // Versão antiga mantida apenas como referência; a versão com rotina aparece abaixo.
  function gerarSemanaNaAgendaLegado() {
    const dist = distribuicaoSemanal(agendaRef);
    if (!dist) { toast('Sem semana ativa no cronograma para gerar.', 'erro'); return; }
    const ini = dist.semana.inicio;
    const fim = D.addDias(ini, 7);
    // remove apenas o que foi gerado antes (blocos manuais ficam)
    state.agenda = state.agenda.filter(function (a) {
      return !(a.gerado && a.data >= ini && a.data < fim && (!a.planoId || a.planoId === state.planoAtivoId));
    });
    let dia = 0; // seg..sáb (domingo é folga)
    dist.itens.forEach(function (item) {
      const teoria = item.blocos.filter(function (b) { return b.tipo === 'teoria'; })[0];
      const pratica = item.blocos.filter(function (b) { return b.tipo !== 'teoria'; })[0];
      const partes = [];
      if (teoria && pratica) {
        partes.push({ b: teoria, h: item.horas * 0.6 });
        partes.push({ b: pratica, h: item.horas * 0.4 });
      } else {
        partes.push({ b: teoria || pratica, h: item.horas });
      }
      partes.forEach(function (p) {
        if (!p.b) return;
        state.agenda.push({
          id: window.Store.novoId('agd'), planoId: state.planoAtivoId,
          data: D.addDias(ini, dia % 6), disciplinaId: item.disciplina.id,
          topicoId: p.b.topico || null,
          duracaoMin: Math.max(15, Math.round(p.h * 60 / 5) * 5),
          obs: p.b.tipo === 'teoria' ? '' : p.b.tipo, feito: false, gerado: true
        });
        dia++;
      });
    });
    salvar();
    agendaRef = ini;
    agendaModo = 'semana';
    render();
    toast('Semana ' + dist.semana.semana + ' gerada na agenda — ajuste arrastando os blocos', 'sucesso');
  }

  // ajusta uma duração para o tempo de bloco permitido mais próximo dentro da faixa
  function snapBloco(min, minBloco, maxBloco) {
    const permitidos = TEMPOS_BLOCO.filter(function (v) { return v >= minBloco && v <= maxBloco; });
    const opts = permitidos.length ? permitidos : TEMPOS_BLOCO;
    return opts.reduce(function (melhor, v) {
      return Math.abs(v - min) < Math.abs(melhor - min) ? v : melhor;
    }, opts[0]);
  }

  function dividirBlocosMinutos(totalMin, minBloco, maxBloco) {
    let restante = Math.max(5, Math.round(totalMin / 5) * 5);
    const partes = [];
    maxBloco = Math.max(5, Math.round(maxBloco / 5) * 5);
    minBloco = Math.max(5, Math.round(minBloco / 5) * 5);
    while (restante > maxBloco) {
      partes.push(maxBloco);
      restante -= maxBloco;
    }
    if (restante > 0) partes.push(restante);
    if (partes.length > 1 && partes[partes.length - 1] < minBloco) {
      partes[partes.length - 2] += partes.pop();
    }
    // Regra 1: cada bloco precisa cair em um dos tempos permitidos (30/45/60/75/90/120)
    return partes.map(function (p) { return snapBloco(p, minBloco, maxBloco); });
  }

  function ordenarTarefasIntercaladas(filas) {
    const ativas = filas.filter(function (f) { return f.tarefas.length > 0; });
    const saida = [];
    let ultimoId = '';
    let ultimoGrupo = '';
    while (ativas.some(function (f) { return f.tarefas.length > 0; })) {
      // Ordena por tarefas restantes (desc) para distribuir disciplinas pesadas ao longo de toda a semana
      ativas.sort(function (a, b) { return b.tarefas.length - a.tarefas.length; });
      let idx = ativas.findIndex(function (f) {
        return f.tarefas.length > 0 && f.disciplina.id !== ultimoId && f.grupo !== ultimoGrupo;
      });
      if (idx < 0) idx = ativas.findIndex(function (f) { return f.tarefas.length > 0 && f.disciplina.id !== ultimoId; });
      if (idx < 0) idx = ativas.findIndex(function (f) { return f.tarefas.length > 0; });
      const fila = ativas[idx];
      const tarefa = fila.tarefas.shift();
      saida.push(tarefa);
      ultimoId = fila.disciplina.id;
      ultimoGrupo = fila.grupo;
    }
    return saida;
  }

  // núcleo da geração: preenche a agenda de UMA semana a partir do cronograma
  // (sem toast/salvar/render — quem chama decide). Retorna null se não houver semana.
  function gerarBlocosSemanaAgenda(refInicio, opts) {
    const incluirPassados = !!(opts && opts.incluirPassados);
    const dist = distribuicaoSemanal(refInicio);
    if (!dist) return null;
    const rotina = rotinaEstudosAtual();
    const diasAtivos = ROTINA_DIAS.filter(function (d) {
      return rotina.dias[d.id] && rotina.dias[d.id].ativo && rotina.dias[d.id].minutos > 0;
    }).sort(function (a, b) { return a.offset - b.offset; });
    if (diasAtivos.length === 0) return null;

    const ini = dist.semana.inicio;
    const fim = D.addDias(ini, 7);
    // preservarDia (AAAA-MM-DD): mantém intactos os blocos até esse dia (hoje e o
    // passado da semana) e regenera SÓ os dias seguintes. Usado no recálculo do
    // meio da semana: preserva o que já foi estudado hoje e recalcula os demais
    // dias — sem apagar o dia atual nem pular a semana inteira.
    const preservarDia = (opts && opts.preservarDia) || null;
    state.agenda = state.agenda.filter(function (a) {
      if (!(a.gerado && a.data >= ini && a.data < fim && (!a.planoId || a.planoId === state.planoAtivoId))) return true;
      if (preservarDia && a.data <= preservarDia) return true; // hoje e o passado ficam
      return false;
    });

    const minBloco = Math.max(5, rotina.minBloco || 45);
    const maxBloco = Math.max(minBloco, rotina.maxBloco || 60);
    const filas = dist.itens.map(function (item) {
      const teoria = item.blocos.filter(function (b) { return b.tipo === 'teoria'; })[0];
      const pratica = item.blocos.filter(function (b) { return b.tipo !== 'teoria'; })[0];
      const partes = [];
      if (teoria && pratica) {
        partes.push({ b: teoria, min: item.horas * 60 * 0.6 });
        partes.push({ b: pratica, min: item.horas * 60 * 0.4 });
      } else {
        partes.push({ b: teoria || pratica, min: item.horas * 60 });
      }
      const tarefas = [];
      partes.forEach(function (p) {
        if (!p.b) return;
        dividirBlocosMinutos(p.min, minBloco, maxBloco).forEach(function (dur) {
          tarefas.push({ disciplina: item.disciplina, bloco: p.b, duracaoMin: dur });
        });
      });
      return { disciplina: item.disciplina, grupo: grupoCognitivoDisciplina(item.disciplina), tarefas: tarefas };
    });
    const tarefas = ordenarTarefasIntercaladas(filas);
    // Na semana corrente não criamos blocos em dias que já passaram (seriam
    // tarefas impossíveis que entrariam como "atrasadas" no mesmo instante).
    const hojeRef = D.hojeISO();
    const ehSemanaAtual = ini === D.segundaDaSemana(hojeRef);
    const slots = diasAtivos.map(function (d) {
      const cfg = rotina.dias[d.id];
      return { data: D.addDias(ini, d.offset), restante: cfg.minutos || 0 };
    }).filter(function (s) {
      if (preservarDia) return s.data > preservarDia; // só os dias APÓS o preservado
      return incluirPassados || !ehSemanaAtual || s.data >= hojeRef;
    });
    if (slots.length === 0) return 0;
    // Blocos manuais e ajustes confirmados são fixos. Eles sobrevivem ao
    // recálculo e consomem primeiro a disponibilidade do dia, evitando que o
    // motor empilhe uma segunda carga por cima da decisão do usuário.
    slots.forEach(function (s) {
      const fixosMin = doAtivo(state.agenda).filter(function (b) {
        return b && b.data === s.data && !b.gerado;
      }).reduce(function (n, b) { return n + (b.duracaoMin || 0); }, 0);
      s.restante = Math.max(0, s.restante - fixosMin);
    });
    // As revisões do dia (repetição espaçada) consomem o tempo PRIMEIRO — são
    // sensíveis a prazo. O que sobra é o que teoria/questões podem ocupar.
    slots.forEach(function (s) { s.restante = Math.max(0, s.restante - D.minutosRevisaoNoDia(state, s.data)); });
    function colocar(slot, disciplina, bloco, dur) {
      const topico = bloco.topico ? D.topicoPorId(state, bloco.topico) : null;
      // dia já passado num preenchimento retroativo (modo exemplo): nasce concluído.
      const diaPassado = incluirPassados && slot.data < hojeRef;
      const obj = {
        id: window.Store.novoId('agd'), planoId: state.planoAtivoId,
        data: slot.data, disciplinaId: disciplina.id,
        topicoId: bloco.topico || null,
        duracaoMin: dur,
        obs: bloco.tipo === 'teoria' ? 'teoria' : bloco.tipo,
        // só a teoria de um tópico já vencido nasce "feita"; questões/revisão não
        feito: diaPassado || (bloco.tipo === 'teoria' && topico ? (topico.status === 'teoria_concluida' || topico.status === 'dominado') : false),
        gerado: true
      };
      if (diaPassado) obj.feitoMin = dur;
      state.agenda.push(obj);
      slot.ultimoBloco = obj;
      return obj;
    }

    let slotIdx = 0;
    let pendentes = 0;
    tarefas.forEach(function (tarefa) {
      while (slotIdx < slots.length && slots[slotIdx].restante < Math.min(minBloco, tarefa.duracaoMin)) slotIdx++;
      if (slotIdx >= slots.length) { pendentes += tarefa.duracaoMin; return; }
      let slot = slots[slotIdx];
      if (tarefa.duracaoMin > slot.restante && slot.restante >= minBloco) {
        pendentes += tarefa.duracaoMin - slot.restante;
        tarefa.duracaoMin = slot.restante;
      } else if (tarefa.duracaoMin > slot.restante) {
        slotIdx++;
        if (slotIdx >= slots.length || tarefa.duracaoMin > slots[slotIdx].restante) { pendentes += tarefa.duracaoMin; return; }
        slot = slots[slotIdx];
      }
      colocar(slot, tarefa.disciplina, tarefa.bloco, tarefa.duracaoMin);
      slot.restante -= tarefa.duracaoMin;
    });

    // Sobras: o min/max de sessão é a regra inicial, mas o tempo que sobra em
    // cada dia é alocado entre as outras disciplinas (rodízio por peso) e o que
    // ainda restar abaixo do mínimo vira exceção, estendendo o último bloco do
    // dia. Assim a semana usa TODA a carga configurada — sem isso, as horas
    // perdidas distorceriam a conclusão estimada (3/6/9 meses) e o card.
    const poolResidual = [];
    dist.itens.forEach(function (item) {
      const teoria = item.blocos.filter(function (b) { return b.tipo === 'teoria'; })[0];
      const pratica = item.blocos.filter(function (b) { return b.tipo !== 'teoria'; })[0];
      if (teoria) poolResidual.push({ disciplina: item.disciplina, bloco: teoria });
      if (pratica) poolResidual.push({ disciplina: item.disciplina, bloco: pratica });
    });
    let poolIdx = 0;
    let excedente = 0;
    if (poolResidual.length) {
      slots.forEach(function (slot) {
        while (slot.restante >= minBloco) {
          const u = poolResidual[poolIdx++ % poolResidual.length];
          const dur = Math.min(maxBloco, slot.restante);
          colocar(slot, u.disciplina, u.bloco, dur);
          slot.restante -= dur;
        }
        if (slot.restante > 0) {
          if (slot.ultimoBloco) { slot.ultimoBloco.duracaoMin += slot.restante; excedente += slot.restante; }
          else { const u = poolResidual[poolIdx++ % poolResidual.length]; colocar(slot, u.disciplina, u.bloco, slot.restante); }
          slot.restante = 0;
        }
      });
    }
    // Regras de estudo recorrente: troca a disciplina dos blocos deste dia/semana
    // conforme o aluno pediu ("trocar todos" ou "deste dia em diante"). Roda por
    // último para valer sobre os blocos recém-gerados, sem o motor desfazer.
    const regras = (state.config && state.config.regrasAgenda) || [];
    if (regras.length > 0) {
      const daSemana = state.agenda.filter(function (a) {
        return a.gerado && a.data >= ini && a.data < fim && (!a.planoId || a.planoId === state.planoAtivoId);
      });
      D.aplicarRegrasAgenda(daSemana, regras, ini, state.planoAtivoId);
    }
    return { semana: dist.semana, inicio: ini, pendentes: pendentes, excedente: excedente };
  }

  function gerarSemanaNaAgenda() {
    const r = gerarBlocosSemanaAgenda(agendaRef);
    if (!r) { toast('Sem semana ativa no cronograma para gerar (ou rotina sem dias de estudo).', 'erro'); return; }
    salvar();
    agendaRef = r.inicio;
    agendaModo = 'semana';
    render();
    const extra = r.pendentes > 0 ? ' · ' + D.formatarMin(r.pendentes) + ' ficaram sem encaixe' : '';
    toast('Semana ' + r.semana.semana + ' gerada respeitando sua rotina' + extra, r.pendentes > 0 ? 'erro' : 'sucesso');
  }

  // ================= Sincronizacao semanal com Google Calendar =================
  const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

  function googleCalendarConfig() {
    if (!state.config.googleCalendar) state.config.googleCalendar = { clientId: '', calendarId: 'primary', eventos: {} };
    if (!state.config.googleCalendar.calendarId) state.config.googleCalendar.calendarId = 'primary';
    if (!state.config.googleCalendar.eventos) state.config.googleCalendar.eventos = {};
    return state.config.googleCalendar;
  }

  function googleCalendarEventos() {
    return googleCalendarConfig().eventos;
  }

  function fusoHorarioLocal() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'; }
    catch (e) { return 'America/Sao_Paulo'; }
  }

  function obterTokenGoogleCalendar() {
    const cfg = googleCalendarConfig();
    if (!cfg.clientId) {
      toast('Informe o Client ID OAuth em Configuracoes > Google Calendar.', 'erro');
      if (location.hash !== '#ajustes') location.hash = '#ajustes';
      return Promise.reject(new Error('Client ID OAuth ausente'));
    }
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
      toast('Google Identity ainda esta carregando. Tente de novo em alguns segundos.', 'erro');
      return Promise.reject(new Error('Google Identity indisponivel'));
    }
    if (googleCalendarToken && googleCalendarToken.expiraEm > Date.now() + 60000) {
      return Promise.resolve(googleCalendarToken.accessToken);
    }
    return new Promise(function (resolve, reject) {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: cfg.clientId,
        scope: GOOGLE_CALENDAR_SCOPE,
        callback: function (resp) {
          if (!resp || resp.error) {
            reject(new Error(resp && resp.error ? resp.error : 'Autorizacao cancelada'));
            return;
          }
          googleCalendarToken = {
            accessToken: resp.access_token,
            expiraEm: Date.now() + ((parseInt(resp.expires_in, 10) || 3600) * 1000)
          };
          resolve(googleCalendarToken.accessToken);
        }
      });
      try {
        tokenClient.requestAccessToken({ prompt: googleCalendarToken ? '' : 'consent' });
      } catch (e) {
        reject(e);
      }
    });
  }

  async function googleCalendarRequest(token, path, opcoes) {
    opcoes = opcoes || {};
    const headers = Object.assign({
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    }, opcoes.headers || {});
    if (opcoes.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const resp = await fetch('https://www.googleapis.com/calendar/v3' + path, Object.assign({}, opcoes, { headers: headers }));
    let dados = null;
    if (resp.status !== 204) {
      const texto = await resp.text();
      if (texto) {
        try { dados = JSON.parse(texto); } catch (e) { dados = { message: texto }; }
      }
    }
    if (!resp.ok) {
      const erro = new Error((dados && dados.error && dados.error.message) || (dados && dados.message) || ('HTTP ' + resp.status));
      erro.status = resp.status;
      throw erro;
    }
    return dados;
  }

  function calendarPathEventos(sufixo) {
    const calId = encodeURIComponent(googleCalendarConfig().calendarId || 'primary');
    return '/calendars/' + calId + '/events' + (sufixo || '');
  }

  async function buscarEventoGoogleCalendar(token, item) {
    const props = item && item.payload && item.payload.extendedProperties &&
      item.payload.extendedProperties.private;
    if (!props || !props.localId) return null;
    const filtros = [
      'gabaritei=1',
      'tipo=' + (props.tipo || item.tipo || ''),
      'planoId=' + (props.planoId || item.planoId || ''),
      'localId=' + props.localId
    ];
    const query = filtros.map(function (valor) {
      return 'privateExtendedProperty=' + encodeURIComponent(valor);
    });
    query.push('showDeleted=false', 'singleEvents=true', 'maxResults=10');
    const dados = await googleCalendarRequest(token, calendarPathEventos('?' + query.join('&')), { method: 'GET' });
    const itens = dados && Array.isArray(dados.items) ? dados.items : [];
    return itens.find(function (evento) {
      return evento && evento.id && evento.status !== 'cancelled';
    }) || null;
  }

  function intervaloBlocoCalendar(bloco, cursores) {
    const dur = Math.max(5, bloco.duracaoMin || 60);
    let iniMin;
    if (bloco.horaInicio) iniMin = hhmmParaMin(bloco.horaInicio);
    else iniMin = cursores[bloco.data] == null ? 480 : cursores[bloco.data];
    const fimMin = iniMin + dur;
    cursores[bloco.data] = fimMin;
    return { inicio: minParaHHMM(iniMin), fim: minParaHHMM(fimMin) };
  }

  function eventoCalendarDoBloco(bloco, cursores, semanaInicio) {
    const d = D.disciplinaPorId(state, bloco.disciplinaId);
    const t = bloco.topicoId ? D.topicoPorId(state, bloco.topicoId) : null;
    const h = intervaloBlocoCalendar(bloco, cursores);
    const tz = fusoHorarioLocal();
    const partesDesc = [
      state.plano ? state.plano.concurso : '',
      t ? 'Tópico: ' + t.nome : '',
      bloco.obs ? 'Observação: ' + bloco.obs : '',
      'Sincronizado pelo Gabaritei OS'
    ].filter(Boolean);
    return {
      uid: 'agd:' + bloco.id,
      planoId: bloco.planoId || state.planoAtivoId || '',
      semanaInicio: semanaInicio,
      tipo: 'agenda',
      payload: {
        summary: 'Estudo: ' + (d ? d.nome : bloco.disciplinaId),
        description: partesDesc.join('\n'),
        start: { dateTime: bloco.data + 'T' + h.inicio + ':00', timeZone: tz },
        end: { dateTime: bloco.data + 'T' + h.fim + ':00', timeZone: tz },
        reminders: { useDefault: true },
        extendedProperties: { private: { gabaritei: '1', tipo: 'agenda', planoId: bloco.planoId || state.planoAtivoId || '', localId: bloco.id } }
      }
    };
  }

  function eventoCalendarDaRevisao(revisao, semanaInicio) {
    const t = D.topicoPorId(state, revisao.topicoId);
    const d = D.disciplinaDoTopico(state, revisao.topicoId);
    return {
      uid: 'rev:' + revisao.id,
      planoId: revisao.planoId || state.planoAtivoId || '',
      semanaInicio: semanaInicio,
      tipo: 'revisao',
      payload: {
        summary: 'Revisão ' + revisao.tipo + ': ' + (t ? t.nome : revisao.topicoId),
        description: [d ? d.nome : '', state.plano ? state.plano.concurso : '', 'Sincronizado pelo Gabaritei OS'].filter(Boolean).join('\n'),
        start: { date: revisao.dataAgendada },
        end: { date: D.addDias(revisao.dataAgendada, 1) },
        reminders: { useDefault: true },
        extendedProperties: { private: { gabaritei: '1', tipo: 'revisao', planoId: revisao.planoId || state.planoAtivoId || '', localId: revisao.id } }
      }
    };
  }

  function eventosCalendarDaSemana(semanaInicio) {
    const fim = D.addDias(semanaInicio, 7);
    const cursores = {};
    const blocos = doAtivo(state.agenda)
      .filter(function (a) { return a.data >= semanaInicio && a.data < fim; })
      .sort(compararAgenda);
    const eventos = blocos.map(function (b) { return eventoCalendarDoBloco(b, cursores, semanaInicio); });
    doAtivo(state.revisoes)
      .filter(function (r) { return !r.dataConcluida && r.dataAgendada >= semanaInicio && r.dataAgendada < fim && D.topicoPorId(state, r.topicoId); })
      .forEach(function (r) { eventos.push(eventoCalendarDaRevisao(r, semanaInicio)); });
    return eventos;
  }

  async function inserirEventoGoogleCalendar(token, item) {
    return googleCalendarRequest(token, calendarPathEventos('?sendUpdates=none'), {
      method: 'POST',
      body: JSON.stringify(item.payload)
    });
  }

  async function atualizarEventoGoogleCalendar(token, eventId, item) {
    return googleCalendarRequest(token, calendarPathEventos('/' + encodeURIComponent(eventId) + '?sendUpdates=none'), {
      method: 'PUT',
      body: JSON.stringify(item.payload)
    });
  }

  async function excluirEventoGoogleCalendar(token, eventId) {
    try {
      await googleCalendarRequest(token, calendarPathEventos('/' + encodeURIComponent(eventId) + '?sendUpdates=none'), { method: 'DELETE' });
    } catch (e) {
      if (e.status !== 404 && e.status !== 410) throw e;
    }
  }

  async function upsertEventoGoogleCalendar(token, item) {
    const mapa = googleCalendarEventos();
    const existente = mapa[item.uid];
    let salvo;
    if (existente && existente.eventId) {
      try {
        salvo = await atualizarEventoGoogleCalendar(token, existente.eventId, item);
      } catch (e) {
        if (e.status !== 404 && e.status !== 410) throw e;
      }
    }
    // Se o mapa local foi apagado/restaurado, recupera o evento remoto pelas
    // propriedades privadas antes de inserir. Assim uma nova sincronização não
    // duplica eventos que já existem no Calendar.
    if (!salvo) {
      const remoto = await buscarEventoGoogleCalendar(token, item);
      if (remoto) {
        try {
          salvo = await atualizarEventoGoogleCalendar(token, remoto.id, item);
        } catch (e) {
          if (e.status !== 404 && e.status !== 410) throw e;
        }
      }
    }
    if (!salvo) salvo = await inserirEventoGoogleCalendar(token, item);
    mapa[item.uid] = {
      eventId: salvo.id,
      htmlLink: salvo.htmlLink || '',
      planoId: item.planoId,
      semanaInicio: item.semanaInicio,
      tipo: item.tipo,
      atualizadoEm: new Date().toISOString()
    };
    return salvo;
  }

  async function sincronizarGoogleCalendarSemana() {
    if (!state.planoAtivoId) { toast('Escolha um plano antes de sincronizar o Calendar.', 'erro'); return; }
    const inicioAlvo = agendaModo === 'semana' ? agendaRef : D.segundaDaSemana(D.hojeISO());
    if (inicioAlvo === D.segundaDaSemana(D.hojeISO())) verificarRecalculoSemanal();
    const gerada = gerarBlocosSemanaAgenda(inicioAlvo);
    const semanaInicio = gerada && gerada.inicio ? gerada.inicio : inicioAlvo;
    const eventos = eventosCalendarDaSemana(semanaInicio);
    if (eventos.length === 0) { toast('Nada nesta semana para sincronizar.', 'erro'); return; }
    const token = await obterTokenGoogleCalendar();
    const mapa = googleCalendarEventos();
    const ativos = new Set(eventos.map(function (e) { return e.uid; }));
    const antigos = Object.keys(mapa).filter(function (uid) {
      const info = mapa[uid];
      return info && info.planoId === state.planoAtivoId && info.semanaInicio === semanaInicio && !ativos.has(uid);
    });
    let removidos = 0, salvos = 0;
    for (const uid of antigos) {
      if (mapa[uid] && mapa[uid].eventId) await excluirEventoGoogleCalendar(token, mapa[uid].eventId);
      delete mapa[uid];
      removidos++;
    }
    for (const item of eventos) {
      await upsertEventoGoogleCalendar(token, item);
      salvos++;
    }
    salvar();
    agendaRef = semanaInicio;
    agendaModo = 'semana';
    render();
    toast('Google Calendar sincronizado: ' + salvos + ' eventos' + (removidos ? ' · ' + removidos + ' removidos' : ''), 'sucesso');
  }

  async function excluirEventosPlanoGoogleCalendar(planoId) {
    const mapa = googleCalendarEventos();
    const uids = Object.keys(mapa).filter(function (uid) { return mapa[uid] && mapa[uid].planoId === planoId; });
    if (uids.length === 0) return { removidos: 0, pendentes: 0 };
    const cfg = googleCalendarConfig();
    if (!cfg.clientId) return { removidos: 0, pendentes: uids.length };
    try {
      const token = await obterTokenGoogleCalendar();
      let removidos = 0;
      for (const uid of uids) {
        if (mapa[uid] && mapa[uid].eventId) await excluirEventoGoogleCalendar(token, mapa[uid].eventId);
        delete mapa[uid];
        removidos++;
      }
      return { removidos: removidos, pendentes: 0 };
    } catch (e) {
      console.warn('Falha ao limpar eventos do Google Calendar', e);
      return { removidos: 0, pendentes: uids.length };
    }
  }

  // ================= Exportar para o calendário (.ics) =================
  // Gera um arquivo iCalendar com os blocos do cronograma e as revisões.
  // Zero custo / sem API: o aluno importa no Google Calendar, Apple ou Outlook.
  // A arquitetura fica pronta para uma sincronização por API numa fase futura.
  function baixarArquivo(nome, conteudo, mime) {
    const blob = new Blob([conteudo], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }
  function icsEscape(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }
  function icsSoDigitos(iso) { return String(iso).replace(/-/g, ''); }
  function hhmmParaMin(hhmm) { const p = String(hhmm).split(':'); return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0); }
  function minParaHHMM(min) { min = Math.max(0, Math.min(min, 24 * 60 - 1)); const h = Math.floor(min / 60), m = min % 60; return (h < 10 ? '0' + h : '' + h) + ':' + (m < 10 ? '0' + m : '' + m); }
  function carimboIcs() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); }
  function veventoTimed(uid, dataISO, hIni, hFim, titulo, desc) {
    const d = icsSoDigitos(dataISO);
    return ['BEGIN:VEVENT', 'UID:' + uid + '@gabaritei', 'DTSTAMP:' + carimboIcs(),
      'DTSTART:' + d + 'T' + hIni.replace(':', '') + '00', 'DTEND:' + d + 'T' + hFim.replace(':', '') + '00',
      'SUMMARY:' + icsEscape(titulo), 'DESCRIPTION:' + icsEscape(desc), 'END:VEVENT'].join('\r\n');
  }
  function veventoDiaInteiro(uid, dataISO, titulo, desc) {
    const d = icsSoDigitos(dataISO), dFim = icsSoDigitos(D.addDias(dataISO, 1));
    return ['BEGIN:VEVENT', 'UID:' + uid + '@gabaritei', 'DTSTAMP:' + carimboIcs(),
      'DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + dFim,
      'SUMMARY:' + icsEscape(titulo), 'DESCRIPTION:' + icsEscape(desc), 'END:VEVENT'].join('\r\n');
  }
  function gerarIcs(opts) {
    opts = opts || {};
    const hoje = D.hojeISO();
    const eventos = [];
    if (opts.blocos !== false) {
      const blocos = doAtivo(state.agenda)
        .filter(function (a) { return a.data >= hoje; })
        .sort(function (a, b) { return a.data.localeCompare(b.data) || (a.horaInicio || '').localeCompare(b.horaInicio || '') || a.id.localeCompare(b.id); });
      let dia = null, cursor = 480; // 08:00 quando não há horário definido
      blocos.forEach(function (b) {
        const d = D.disciplinaPorId(state, b.disciplinaId);
        const t = b.topicoId ? D.topicoPorId(state, b.topicoId) : null;
        const dur = b.duracaoMin || 60;
        let ini, fim;
        if (b.horaInicio) {
          const iniMin = hhmmParaMin(b.horaInicio), fimMin = iniMin + dur;
          ini = b.horaInicio; fim = minParaHHMM(fimMin);
          if (b.data === dia) cursor = Math.max(cursor, fimMin); else { dia = b.data; cursor = fimMin; }
        } else {
          if (b.data !== dia) { dia = b.data; cursor = 480; }
          ini = minParaHHMM(cursor); fim = minParaHHMM(cursor + dur); cursor += dur;
        }
        const titulo = (d ? d.nome : 'Estudo') + (b.obs ? ' · ' + b.obs : '');
        eventos.push(veventoTimed(b.id + '-agd', b.data, ini, fim, titulo, t ? t.nome : ''));
      });
    }
    if (opts.revisoes !== false) {
      doAtivo(state.revisoes)
        .filter(function (r) { return !r.dataConcluida && r.dataAgendada >= hoje && D.topicoPorId(state, r.topicoId); })
        .forEach(function (r) {
          const t = D.topicoPorId(state, r.topicoId);
          const dcb = D.disciplinaDoTopico(state, r.topicoId);
          eventos.push(veventoDiaInteiro(r.id + '-rev', r.dataAgendada, '🔁 Revisão ' + r.tipo + ' — ' + t.nome, dcb ? dcb.nome : ''));
        });
    }
    const corpo = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gabaritei OS//Cronograma//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
      .concat(eventos).concat(['END:VCALENDAR']);
    return { texto: corpo.join('\r\n'), nEventos: eventos.length };
  }

  function abrirExportarCalendario() {
    const m = abrirModal('<h3>Exportar para o calendário</h3>' +
      '<p class="sub">Gera um arquivo <strong>.ics</strong> com seus blocos de estudo e revisões — importável no Google Calendar, Apple ou Outlook. Custo zero, sem login.</p>' +
      '<label class="check-inline"><input type="checkbox" id="ics-blocos" checked> Blocos do cronograma</label><br>' +
      '<label class="check-inline"><input type="checkbox" id="ics-revisoes" checked> Revisões (24h · 3d · 7d · 14d · 30d · reforço)</label>' +
      '<details style="margin-top:0.7rem"><summary style="cursor:pointer;font-weight:700;font-size:0.88rem">Como importar no Google Calendar</summary>' +
      '<p class="sub" style="margin-top:0.4rem">No computador: Google Calendar → ⚙ Configurações → <em>Importar e exportar</em> → escolha o arquivo .ics → <em>Importar</em>. O app continua sendo a fonte do plano; reexporte quando o cronograma mudar.</p></details>' +
      '<div class="modal-acoes"><button class="botao-quieto" id="ics-cancelar">Fechar</button>' +
      '<button id="ics-baixar">Baixar .ics</button></div>');
    m.querySelector('#ics-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#ics-baixar').addEventListener('click', function () {
      const r = gerarIcs({ blocos: m.querySelector('#ics-blocos').checked, revisoes: m.querySelector('#ics-revisoes').checked });
      if (r.nEventos === 0) { toast('Nada futuro para exportar — gere a semana no calendário primeiro.', 'erro'); return; }
      const slug = state.plano ? state.plano.concurso.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 30).replace(/^-|-$/g, '') : 'plano';
      baixarArquivo('gabaritei-' + (slug || 'plano') + '.ics', r.texto, 'text/calendar;charset=utf-8');
      fecharModal();
      toast('Calendário exportado: ' + r.nEventos + ' eventos (.ics)', 'sucesso');
    });
  }

  // preenche o calendário inteiro (todas as semanas do cronograma ativo) — usado
  // logo após importar um plano ou gerar o cronograma, para a aba Planejamento
  // já aparecer com os tópicos no calendário semanal e mensal
  // soVazias=true: só PREENCHE semanas que ainda não têm blocos gerados, sem
  // regenerar (e apagar) as que já existem. Isso é essencial no render do "Hoje",
  // que chama esta função a cada desenho: sem o guard, marcar um bloco como feito
  // seria desfeito no render seguinte (a agenda da semana era recriada do zero).
  function sincronizarAgendaComCronograma(soVazias) {
    const cron = D.cronogramaAtivo(state);
    if (!cron || cron.length === 0) return 0;
    let semanas = 0;
    cron.forEach(function (sem) {
      if (soVazias) {
        const fim = D.addDias(sem.inicio, 7);
        const jaTem = state.agenda.some(function (a) {
          return a.gerado && a.data >= sem.inicio && a.data < fim && (!a.planoId || a.planoId === state.planoAtivoId);
        });
        if (jaTem) return; // semana já preenchida → preserva o progresso
      }
      if (gerarBlocosSemanaAgenda(sem.inicio)) semanas++;
    });
    return semanas;
  }

  function abrirPerfilPlano(planoId) {
    const entrada = state.planos.find(function (p) { return p.id === planoId; });
    if (!entrada) return;
    const discs = entrada.disciplinas.filter(function (d) { return d.id !== 'ORF'; });
    const m = abrirModal(
      '<h3>Ajustar o plano ao seu perfil</h3>' +
      '<p style="font-size:0.85rem;color:var(--grafite)">Marque como você se sente em cada disciplina. Isso muda a fatia de horas que cada uma recebe na distribuição semanal — sem mexer na ordem do cronograma.</p>' +
      '<table><thead><tr><th>Disciplina</th><th>Como você está</th></tr></thead><tbody>' +
      discs.map(function (d) {
        const v = d.dificuldade || 'normal';
        return '<tr><td>' + tagDisc(d) + ' ' + esc(d.nome) + '</td>' +
          '<td><select data-perfil="' + esc(d.id) + '" style="min-height:38px;padding:0.25rem 0.5rem">' +
          '<option value="facil"' + (v === 'facil' ? ' selected' : '') + '>Tenho facilidade (−25%)</option>' +
          '<option value="normal"' + (v === 'normal' ? ' selected' : '') + '>Normal</option>' +
          '<option value="dificil"' + (v === 'dificil' ? ' selected' : '') + '>Tenho dificuldade (+40%)</option>' +
          '</select></td></tr>';
      }).join('') +
      '</tbody></table>' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="pf-cancelar">Cancelar</button>' +
      '<button type="button" id="pf-salvar">Aplicar perfil</button></div>'
    );
    m.querySelector('#pf-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#pf-salvar').addEventListener('click', function () {
      m.querySelectorAll('[data-perfil]').forEach(function (sel) {
        const d = entrada.disciplinas.find(function (x) { return x.id === sel.getAttribute('data-perfil'); });
        if (d) d.dificuldade = sel.value;
      });
      salvar(); fecharModal(); render();
      toast('Perfil aplicado — a distribuição semanal foi recalculada', 'sucesso');
    });
  }

  // ---------------- TELA: Mais (atalhos no celular) ----------------
  function abrirFeedback() {
    const m = abrirModal(
      '<h3>Ajude a melhorar o Gabaritei OS</h3>' +
      '<p class="sub">Encontrou um erro, teve uma ideia ou sentiu falta de alguma coisa? Sua mensagem ajuda a decidir as próximas melhorias.</p>' +
      '<div class="card card-quieto" style="margin:0.85rem 0;padding:0.9rem 1rem">' +
      '<p style="margin:0 0 0.45rem"><strong>Para erros</strong>, envie a tela, o que você fez e o que esperava acontecer.</p>' +
      '<p style="margin:0"><strong>Para sugestões</strong>, conte qual problema a melhoria resolveria para você.</p>' +
      '</div>' +
      '<p class="sub">Por enquanto, o canal de contato é o Instagram <strong>@samuel_g.silva</strong>.</p>' +
      '<div class="modal-acoes">' +
      '<button type="button" class="botao-quieto" id="feedback-fechar">Agora não</button>' +
      '<a class="botao botao-instagram" href="' + INSTAGRAM_DIRECT_URL + '" target="_blank" rel="noopener noreferrer">' +
      '<svg aria-hidden="true"><use href="#ic-instagram"/></svg>Abrir Direct</a>' +
      '</div>'
    );
    m.querySelector('#feedback-fechar').addEventListener('click', fecharModal);
  }

  function telaMais() {
    const itens = [
      ['#stats', 'Desempenho'],
      ['#simulados', 'Simulados'],
      ['#timer', 'Timer'],
      ['#ajustes', 'Configurações']
    ];
    return '<h1 class="sr-only">Mais opções</h1><div class="card card-quieto mais-menu mais-menu-anima">' +
      itens.map(function (i) {
        return '<a class="mais-item" href="' + i[0] + '">' +
          '<span class="mais-item-nome">' + i[1] + '</span>' +
          '<span class="mais-item-seta" aria-hidden="true">›</span></a>';
      }).join('') +
      '<button type="button" class="mais-item mais-item-botao" id="mais-feedback">' +
      '<span class="mais-item-nome">Feedback, erros e sugestões</span>' +
      '<span class="mais-item-seta" aria-hidden="true">›</span></button>' +
      '</div>';
  }

  function ligarMais(raiz) {
    const feedback = raiz.querySelector('#mais-feedback');
    if (feedback) feedback.addEventListener('click', abrirFeedback);
  }

  // ---------------- Meta semanal de questões (editada na própria Hoje) ----------------
  function editarMetaQuestoes() {
    const atual = (state.config && state.config.metaQuestoesSemana) || 100;
    const m = abrirModal(
      '<h3>Meta de questões por semana</h3>' +
      '<p style="font-size:0.85rem;color:var(--grafite)">Quantas questões você quer resolver por semana.</p>' +
      '<input id="mq-valor" type="number" min="0" max="2000" value="' + atual + '" style="max-width:160px">' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="mq-cancelar">Cancelar</button>' +
      '<button type="button" id="mq-salvar">Salvar</button></div>'
    );
    m.querySelector('#mq-cancelar').addEventListener('click', fecharModal);
    m.querySelector('#mq-salvar').addEventListener('click', function () {
      state.config.metaQuestoesSemana = Math.max(0, Math.min(2000, parseInt(m.querySelector('#mq-valor').value, 10) || 0));
      salvar(); fecharModal(); render();
      toast('Meta de questões atualizada', 'sucesso');
    });
  }

  // ---------------- Perfil (menu superior) ----------------
  // Bloco de metas no Perfil: questões/semana, % de acerto geral e por disciplina.
  function perfilMetasHtml() {
    const metaQ = (state.config && state.config.metaQuestoesSemana != null) ? state.config.metaQuestoesSemana : 100;
    const geral = metaAcertoGeral();
    const geralVal = (state.config && state.config.metaAcertoPct) ? state.config.metaAcertoPct : '';
    const corte = (state.plano && state.plano.meta && state.plano.meta.corte_pct) || 70;
    const discs = state.disciplinas.filter(function (d) { return d.id !== 'ORF'; });
    let porDisc = '';
    if (discs.length) {
      porDisc = '<details class="pf-metas-disc"><summary>Meta por disciplina (opcional)</summary>' +
        '<p class="sub" style="margin:0.3rem 0 0.5rem">Em branco usa a meta geral (' + geral + '%).</p>' +
        discs.map(function (d) {
          const v = (state.config.metaAcertoDisc && state.config.metaAcertoDisc[d.id]) || '';
          return '<label class="pf-meta-linha"><span>' + esc(nomeDiscCurto(d.nome)) + '</span>' +
            '<input type="number" min="0" max="100" data-meta-disc="' + esc(d.id) + '" value="' + esc(String(v)) + '" placeholder="' + geral + '"></label>';
        }).join('') + '</details>';
    }
    return '<div class="card card-quieto pf-metas" style="margin:0.85rem 0 0;padding:0.9rem 1rem">' +
      '<strong style="display:block;font-size:0.95rem">🎯 Minhas metas</strong>' +
      '<label class="pf-meta-linha"><span>Questões por semana</span>' +
      '<input id="pf-meta-q" type="number" min="0" max="2000" value="' + metaQ + '"></label>' +
      '<label class="pf-meta-linha"><span>Acerto geral (%)</span>' +
      '<input id="pf-meta-geral" type="number" min="0" max="100" value="' + esc(String(geralVal)) + '" placeholder="' + corte + ' (corte)"></label>' +
      porDisc +
      '</div>';
  }

  function abrirPerfilUsuario() {
    const atual = statusSincronizacao();
    const email = atual && atual.usuario && atual.usuario.email ? atual.usuario.email : null;
    const temPlano = !!state.plano;
    const pushDisponivel = !!(window.FirebaseSync && window.FirebaseSync.pushConfigurado &&
      window.FirebaseSync.pushConfigurado());
    const m = abrirModal(
      '<h3>Perfil</h3>' +
      '<label for="pf-nome">Seu nome na tela Hoje</label>' +
      '<input id="pf-nome" type="text" maxlength="40" value="' + esc(state.config.nomeUsuario || nomeUsuario()) + '">' +
      '<label class="pf-toggle" for="pf-som-conquistas">' +
      '<span><strong>Som das conquistas</strong><small>Toca um efeito ao desbloquear uma conquista.</small></span>' +
      '<input id="pf-som-conquistas" type="checkbox"' + (state.config.somConquistasOff ? '' : ' checked') + '></label>' +
      '<label class="pf-toggle" for="pf-lembretes-push">' +
      '<span><strong>Lembretes diários</strong><small>' +
      (pushDisponivel ? 'Receba um lembrete de estudo neste aparelho.' : 'Em breve — notificações programadas ainda não foram configuradas.') +
      '</small></span>' +
      '<input id="pf-lembretes-push" type="checkbox"' +
      (state.config.lembretesPush ? ' checked' : '') + (pushDisponivel ? '' : ' disabled') + '></label>' +
      '<p style="font-size:0.85rem;color:var(--grafite);margin-top:0.75rem">Conta: <strong>' + esc(email || 'não conectada') + '</strong>' +
      (state.plano ? '<br>Plano ativo: <strong>' + esc(state.plano.concurso) + '</strong>' : '') + '</p>' +
      perfilMetasHtml() +
      '<div class="card card-quieto" style="margin:0.85rem 0 0;padding:0.9rem 1rem">' +
      '<strong style="display:block;font-size:0.95rem">Calendário</strong>' +
      '<p class="sub" style="margin:0.3rem 0 0">Exporte um arquivo <strong>.ics</strong> para importar no Google Calendar, Apple ou Outlook.</p>' +
      '<div class="modal-acoes" style="justify-content:flex-start;margin-top:0.75rem">' +
      '<button type="button" class="botao-secundario" id="pf-exportar-cal"' + (temPlano ? '' : ' disabled') + '>Exportar calendário (.ics)</button>' +
      '</div></div>' +
      '<div class="modal-acoes" style="justify-content:space-between;flex-wrap:wrap;gap:0.5rem">' +
      '<a class="botao botao-quieto" href="#ajustes" id="pf-config">Abrir configurações</a>' +
      (email ? '<button type="button" class="botao-quieto" id="pf-sair">Sair da conta</button>' : '') +
      '<button type="button" id="pf-salvar-nome">Salvar</button></div>'
    );
    m.querySelector('#pf-config').addEventListener('click', fecharModal);
    const pfSair = m.querySelector('#pf-sair');
    if (pfSair) pfSair.addEventListener('click', function () {
      sairDaContaComSeguranca(pfSair);
    });
    const pfSom = m.querySelector('#pf-som-conquistas');
    if (pfSom) pfSom.addEventListener('change', function () {
      state.config.somConquistasOff = !pfSom.checked;
      salvar({ sincronizar: false });
      if (pfSom.checked) tocarSomConquista(50); // prévia do som ao reativar
    });
    const pfPush = m.querySelector('#pf-lembretes-push');
    if (pfPush) pfPush.addEventListener('change', async function () {
      if (!pfPush.checked) {
        state.config.lembretesPush = false;
        salvar();
        if (window.FirebaseSync && window.FirebaseSync.desativarPushAtual) {
          await window.FirebaseSync.desativarPushAtual();
        }
        toast('Lembretes diários desativados.', 'sucesso');
        return;
      }
      if (!('Notification' in window)) {
        pfPush.checked = false;
        toast('Este navegador não oferece notificações.', 'erro');
        return;
      }
      const permissao = Notification.permission === 'default'
        ? await Notification.requestPermission().catch(function () { return 'denied'; })
        : Notification.permission;
      if (permissao !== 'granted') {
        pfPush.checked = false;
        state.config.lembretesPush = false;
        salvar();
        toast('Permissão de notificações não concedida.', 'erro');
        return;
      }
      state.config.lembretesPush = true;
      salvar();
      await window.FirebaseSync.registrarPush();
      toast('Lembretes diários ativados neste aparelho.', 'sucesso');
    });
    const pfExportarCal = m.querySelector('#pf-exportar-cal');
    if (pfExportarCal) pfExportarCal.addEventListener('click', function () {
      fecharModal();
      abrirExportarCalendario();
    });
    m.querySelector('#pf-salvar-nome').addEventListener('click', function () {
      state.config.nomeUsuario = m.querySelector('#pf-nome').value.trim();
      state.config.onboardingNomeVisto = true;
      state.config.somConquistasOff = pfSom ? !pfSom.checked : state.config.somConquistasOff;
      // Metas
      const mq = m.querySelector('#pf-meta-q');
      if (mq) state.config.metaQuestoesSemana = Math.max(0, Math.min(2000, parseInt(mq.value, 10) || 0));
      const mg = m.querySelector('#pf-meta-geral');
      if (mg) { const v = parseInt(mg.value, 10); state.config.metaAcertoPct = (v > 0 && v <= 100) ? v : null; }
      const mapa = {};
      m.querySelectorAll('[data-meta-disc]').forEach(function (inp) {
        const v = parseInt(inp.value, 10);
        if (v > 0 && v <= 100) mapa[inp.getAttribute('data-meta-disc')] = v;
      });
      state.config.metaAcertoDisc = mapa;
      salvar();
      fecharModal();
      render();
      toast('Perfil atualizado', 'sucesso');
    });
  }

  // ---------------- roteador ----------------
  const telas = {
    hoje: { render: telaHoje, ligar: ligarHoje },
    planos: { render: telaPlanosNova, ligar: ligarPlanos },
    planejamento: { render: telaPlanejamento, ligar: ligarPlanejamento },
    timer: { render: telaTimer, ligar: ligarTimer },
    revisoes: { render: telaRevisoes, ligar: ligarRevisoes },
    edital: { render: telaEdital, ligar: ligarEdital },
    simulados: { render: telaSimulados, ligar: ligarSimulados },
    stats: { render: telaStats, ligar: ligarStats },
    disciplina: { render: telaDisciplinaDetalhe, ligar: ligarDisciplinaDetalhe },
    historico: { render: telaHistorico, ligar: ligarHistorico },
    ajustes: { render: telaAjustes, ligar: ligarAjustes },
    mais: { render: telaMais, ligar: ligarMais }
  };

  function rotaAtual() {
    const r = location.hash.replace('#', '') || 'hoje';
    if (r.indexOf('disciplina-') === 0) {
      disciplinaDetalheId = decodeURIComponent(r.slice('disciplina-'.length));
      return 'disciplina';
    }
    return telas[r] ? r : 'hoje';
  }

  function atualizarNav(rota) {
    document.querySelectorAll('[data-rota]').forEach(function (el) {
      el.classList.toggle('ativo', el.getAttribute('data-rota') === rota);
    });
    const nVencidas = doAtivo(state.revisoes).filter(function (r) {
      return !r.dataConcluida && r.dataAgendada <= D.hojeISO() && D.topicoPorId(state, r.topicoId);
    }).length;
    const badge = document.getElementById('badge-revisoes');
    const badgeM = document.getElementById('badge-revisoes-m');
    if (badge) { badge.textContent = nVencidas; badge.classList.toggle('oculto', nVencidas === 0); }
    if (badgeM) badgeM.classList.toggle('oculto', nVencidas === 0);
  }

  // Aviso global de sincronização travada: sem ele, o aluno só descobria nos
  // Ajustes que o estudo registrado ficou preso neste aparelho (e os outros
  // abriam "sem nada salvo"). Aparece apenas em erro real com sessão ativa.
  function atualizarAvisoSyncPendente(atual) {
    let aviso = document.getElementById('sync-aviso-pendente');
    const mostrar = !!(atual && atual.usuario && atual.estado === 'erro' && !modoDemo);
    if (!mostrar) { if (aviso) aviso.remove(); return; }
    if (aviso) return;
    aviso = document.createElement('button');
    aviso.id = 'sync-aviso-pendente';
    aviso.type = 'button';
    aviso.className = 'sync-aviso-pendente';
    aviso.textContent = '⚠️ Alterações deste aparelho ainda não foram para a nuvem — toque para sincronizar agora';
    aviso.addEventListener('click', function () {
      if (!window.FirebaseSync || !window.FirebaseSync.ativo()) return;
      aviso.disabled = true;
      aviso.textContent = 'Sincronizando…';
      window.FirebaseSync.sincronizarAgora({ silencioso: false }).finally(function () {
        firebaseStatus = window.FirebaseSync.status();
        atualizarSyncUi();
        const seguiu = document.getElementById('sync-aviso-pendente');
        if (seguiu) {
          seguiu.disabled = false;
          seguiu.textContent = '⚠️ Ainda não consegui sincronizar — verifique a internet e toque para tentar de novo';
        }
      });
    });
    document.body.appendChild(aviso);
  }

  function atualizarSyncUi() {
    const atual = statusSincronizacao();
    atualizarAvisoSyncPendente(atual);
    const el = document.getElementById('sync-status');
    if (el && atual) el.textContent = atual.texto;
    const ep = document.getElementById('sync-endpoint');
    if (ep && atual) ep.textContent = atual.fonte || atual.endpoint || 'servidor local não detectado';
    const conta = document.getElementById('sync-conta');
    if (conta && atual) conta.textContent = atual.usuario && atual.usuario.email ? atual.usuario.email : 'não conectada';
    const login = document.getElementById('fb-login');
    const logout = document.getElementById('fb-logout');
    const conectado = !!(atual && atual.usuario);
    if (login) login.classList.toggle('oculto', conectado);
    if (logout) logout.classList.toggle('oculto', !conectado);
  }

  function render() {
    aplicarTema();
    const conteudo = document.getElementById('conteudo');
    if (!usuarioLogado() && !modoDemo) {
      document.body.classList.add('login-gate');
      delete document.body.dataset.rota;
      if (pintarTimerAtual) pintarTimerAtual = null;
      if (autenticacaoPendente()) {
        conteudo.innerHTML = telaCarregandoAuth();
        atualizarSyncUi();
        return;
      }
      try {
        conteudo.innerHTML = telaLogin();
        ligarLogin(conteudo);
      } catch (err) {
        console.error('Falha ao renderizar login:', err);
        conteudo.innerHTML = '<section class="login-shell"><div class="login-card"><h1>Entrar</h1><p>Não consegui abrir a tela de login.</p></div></section>';
      }
      atualizarSyncUi();
      return;
    }
    document.body.classList.remove('login-gate');
    if (!modoDemo) processarPausasVencidas();
    if (!modoDemo && !pulaRecalcSemanal) verificarRecalculoSemanal(); // Regra 6 — a cada nova semana, plano recalculado pelo progresso real
    const rota = rotaAtual();
    document.body.dataset.rota = rota;
    const mudouRota = rota !== ultimaRotaRender;
    ultimaRotaRender = rota;
    const tela = telas[rota];
    if (rota !== 'timer') { pintarTimerAtual = null; timerBlocoPendente = null; timerRevisaoPendente = null; timerLimitePendente = null; timerAutoIniciar = false; }
    // À prova de falhas: um erro numa tela não pode mais congelar a navegação
    // (deixar a tela em branco sem feedback). Mostra o erro e segue navegável.
    try {
      conteudo.innerHTML = tela.render();
      tela.ligar(conteudo);
    } catch (err) {
      console.error('Falha ao renderizar a tela "' + rota + '":', err);
      conteudo.innerHTML = '<h1>Ops…</h1><div class="card"><p>Não consegui abrir esta tela por causa de um dado inesperado. ' +
        'As outras telas continuam funcionando.</p>' +
        '<p style="font-size:0.82rem;color:var(--grafite);white-space:pre-wrap;margin-top:0.5rem">' +
        esc(String(err && err.message ? err.message : err)) + '</p></div>';
    }
    if (modoDemo) injetarBannerDemo(conteudo);
    else if (modoOfflineLocal) injetarBannerOffline(conteudo);
    atualizarNav(rota);
    atualizarSyncUi();
    if (mudouRota) setTimeout(function () { window.scrollTo(0, 0); }, 0);
    setTimeout(abrirOnboardingNome, 0);
    // Parabéns da meta do dia dispara ao CONCLUIR a meta, esteja o aluno em
    // qualquer aba (não só ao abrir Hoje). Guardado por metaDiaEm (1x/dia).
    if (!modoDemo) { try { talvezComemorarDia(); } catch (e) {} }
  }

  // Faixa fixa no topo do conteúdo durante o modo exemplo, com convite ao login.
  function injetarBannerDemo(conteudo) {
    conteudo.insertAdjacentHTML('afterbegin',
      '<div class="demo-banner">' +
      '<span class="demo-banner-txt">🔎 Modo exemplo — explore à vontade. Nada é salvo.</span>' +
      '<span class="demo-banner-acoes">' +
      '<button type="button" class="botao-mini" id="demo-entrar">Entrar com Google</button>' +
      '<button type="button" class="botao-mini botao-quieto" id="demo-sair">Sair</button>' +
      '</span></div>');
    const entrar = conteudo.querySelector('#demo-entrar');
    if (entrar) entrar.addEventListener('click', function () {
      if (!window.FirebaseSync) { toast('Login ainda está carregando. Tente de novo.', 'erro'); return; }
      window.FirebaseSync.login().catch(function () {
        toast('Não consegui abrir o login do Google.', 'erro');
      });
    });
    const sair = conteudo.querySelector('#demo-sair');
    if (sair) sair.addEventListener('click', sairModoDemo);
  }

  function injetarBannerOffline(conteudo) {
    conteudo.insertAdjacentHTML('afterbegin',
      '<div class="demo-banner offline-banner" role="status">' +
      '<span class="demo-banner-txt">📴 Modo offline — usando os dados salvos neste aparelho. As alterações serão sincronizadas quando sua sessão voltar.</span>' +
      '</div>');
  }

  function sairModoDemo() {
    modoDemo = false;
    state = window.Store.carregar();
    if (location.hash && location.hash !== '#hoje') location.hash = '';
    render();
  }

  // Modo exemplo: transforma o histórico de sessões (que alimenta KPIs/streak) em
  // blocos de agenda CONCLUÍDOS nas SEMANAS ANTERIORES, para o calendário também
  // mostrar o esforço já feito ao navegar para trás. A semana CORRENTE é tratada
  // à parte (gerada cheia pelo motor, com os dias passados marcados feitos), então
  // aqui só preenchemos antes da segunda desta semana. Agrupa por dia+tópico+tipo.
  function semearAgendaPassadaDemo() {
    const hoje = D.hojeISO();
    const limite = D.segundaDaSemana(hoje); // só semanas anteriores à corrente
    const sessoes = D.sessoesDoPlano(state).filter(function (s) {
      return s.data && s.data.slice(0, 10) < limite && s.topicoId;
    });
    if (!sessoes.length) return;
    const grupos = {};
    sessoes.forEach(function (s) {
      const dia = s.data.slice(0, 10);
      const tipo = (s.tipo === 'teoria' || s.tipo === 'questoes' || s.tipo === 'revisao') ? s.tipo : 'teoria';
      const chave = dia + '|' + s.topicoId + '|' + tipo;
      if (!grupos[chave]) grupos[chave] = { dia: dia, topicoId: s.topicoId, tipo: tipo, min: 0 };
      grupos[chave].min += s.duracaoMin || 0;
    });
    Object.keys(grupos).forEach(function (chave) {
      const g = grupos[chave];
      const disc = D.disciplinaDoTopico(state, g.topicoId);
      if (!disc) return;
      const min = Math.max(5, Math.round(g.min));
      state.agenda.push({
        id: window.Store.novoId('agd'), planoId: state.planoAtivoId,
        data: g.dia, disciplinaId: disc.id, topicoId: g.topicoId,
        duracaoMin: min, feitoMin: min, feito: true, obs: g.tipo
      });
    });
    // Revisões vencidas (data agendada já passou) num aluno dedicado já teriam sido
    // feitas. O calendário só mostra revisão PENDENTE — uma concluída some, não fica
    // riscada — então uma revisão vencida e não concluída dá a impressão de que ele
    // estudou o dia mas "furou" a revisão. Marca como concluída na própria data
    // prevista para sumir do passado; as de hoje/futuras seguem pendentes.
    doAtivo(state.revisoes).forEach(function (r) {
      if (!r.dataConcluida && r.dataAgendada && r.dataAgendada < hoje) {
        r.dataConcluida = r.dataAgendada;
      }
    });
  }

  function entrarModoDemo(btn, opcoes) {
    opcoes = opcoes || {};
    if (modoDemo) { if (opcoes.aoConcluir) opcoes.aoConcluir(); return; }
    if (btn) btn.disabled = true;
    fetch('data/exemplo-trf3.json?v=20260718g-integridade-sync')
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (json) {
        modoDemo = true;            // antes de adicionarPlano: salvar() vira no-op
        state = window.Store.estadoVazio();
        adicionarPlano(json);
        // O modo demo não chama Store.salvar(); normalize explicitamente para aplicar
        // migrações e corrigir sementes antigas/caches com acertos acima do total.
        window.Store.normalizar(state);
        state.config.nomeUsuario = '';
        state.config.onboardingNomeVisto = true;
        // garante o plano ativo mesmo se houver corrida com o status do Firebase
        if (!state.planoAtivoId && state.planos && state.planos.length) {
          window.Store.ativarPlano(state, state.planos[0].id);
        }
        // Demo representa um aluno dedicado (~30h/semana): regenera o cronograma
        // com o gerador real a essa carga, para o calendário e os KPIs ficarem
        // cheios. Os tópicos já estudados/dominados saem da fila (manutenção).
        const entradaDemo = entradaPlanoAtivo();
        if (entradaDemo && entradaDemo.disciplinas.some(function (d) { return d.id !== 'ORF' && (d.topicos || []).length; })) {
          aplicarPlanoDuracaoAoAtivo(null, 30, true);
        }
        // O cronograma nasce só para FRENTE (de hoje em diante). Sem isto, os dias
        // já estudados (incl. seg–sex da semana corrente e semanas anteriores)
        // aparecem vazios no calendário — o aluno dedicado parece ter "furado" a
        // semana. Duas peças: (1) regenera a semana corrente CHEIA (todos os dias,
        // ~carga planejada), com os dias passados marcados feitos — assim a "Carga
        // horária planejada / semana" reflete a meta real (e não só hoje/amanhã);
        // (2) materializa o histórico de sessões nas semanas anteriores.
        semearAgendaPassadaDemo();
        gerarBlocosSemanaAgenda(D.segundaDaSemana(D.hojeISO()), { incluirPassados: true });
        // navega para #hoje e renderiza de forma determinística (não depende só do
        // evento hashchange, que pode não disparar se já estávamos em #hoje).
        if (location.hash !== '#hoje') location.hash = '#hoje';
        render();
        carregarCatalogoGlobalFirebase(); // modo exemplo vê o catálogo global real (Firebase)
        if (!opcoes.silencioso && !opcoes.ofertarTour) toast('Modo exemplo ativado — explore à vontade', 'sucesso');
        if (opcoes.aoConcluir) opcoes.aoConcluir();
        // Adia a oferta: trocar o hash para #hoje dispara um hashchange que chama
        // fecharModal() — se abríssemos a oferta agora, ela seria fechada logo em
        // seguida (por isso "só aparecia na 2ª entrada"). 200ms garante que o
        // hashchange já passou.
        if (opcoes.ofertarTour) setTimeout(ofertarTourDemo, 200);
      })
      .catch(function () {
        if (btn) btn.disabled = false;
        toast('Não consegui carregar o plano de exemplo. Tente de novo.', 'erro');
      });
  }

  // ===================== Tour guiado (modo exemplo) =====================
  // Oferecido ao entrar no modo exemplo (e pelo Perfil). Roda DENTRO do demo, onde
  // nada é salvo. Visitante: ao fim, continua no demo explorando. Vindo de conta
  // real (Perfil): ao fim, volta ao estado real intacto.
  const PASSOS_TOUR = [
    { rota: 'hoje', seletor: null,
      titulo: '👋 Bem-vindo ao Gabaritei OS!',
      texto: 'Vou te mostrar em 1 minuto como tudo funciona, usando um plano de exemplo. Nada aqui é salvo na sua conta — é só uma demonstração.' },
    { rota: 'hoje', seletor: '#conteudo .estudar-hoje-card',
      titulo: '🎯 O que estudar hoje',
      texto: 'Este é seu ponto de partida diário: a fila com o que estudar hoje, já na ordem certa. Você abre o app e sabe exatamente por onde começar.' },
    { rota: 'hoje', seletor: '#conteudo .constancia-card',
      titulo: '🔥 Mapa de constância (heatmap)',
      texto: 'Cada quadradinho é um dia: quanto mais você estuda, mais forte a cor. Ele te ajuda a manter a sequência de dias estudando, sem furos.' },
    { rota: 'hoje', seletor: '#conteudo .conquistas-card',
      titulo: '🏅 Conquistas',
      texto: 'Medalhas que você desbloqueia conforme avança (constância, simulados, metas…). Toque numa delas para ver como conquistar e a raridade — uma motivação extra.' },
    { rota: 'hoje', seletor: '#conteudo .painel-disciplinas-card',
      titulo: '📚 Painel de disciplinas',
      texto: 'Toque em qualquer disciplina para abrir a tela de detalhes dela: histórico de estudos, desempenho por tópico e o edital verticalizado. É onde você mergulha em cada matéria.' },
    { rota: 'planejamento', seletor: '#conteudo .checkin-card, #conteudo .card',
      titulo: '📅 Planejamento & Agenda',
      texto: 'Aqui fica seu cronograma da semana, o check-in semanal e a projeção de conclusão. Dá para arrastar matérias para os dias.' },
    { rota: 'timer', seletor: '#conteudo .timer-page, #conteudo .card',
      titulo: '⏱️ Timer',
      texto: 'Cronometre o estudo (cronômetro ou pomodoro). O tempo abate automaticamente do bloco do dia e entra nas suas estatísticas.' },
    { rota: 'revisoes', seletor: '#conteudo .card',
      titulo: '🔁 Revisões & Flashcards',
      texto: 'O app agenda revisões sozinho na curva do esquecimento (24h · 3d · 7d · 14d · 30d) e ainda as ajusta pelo seu DESEMPENHO: foi bem, ele espaça; foi mal, ele aproxima (e pode reabrir o tópico). Na aba Flashcards você cria cartas (frente/verso) com repetição espaçada — ótimo para memorizar leis, conceitos e datas.' },
    { rota: 'simulados', seletor: '#conteudo .card',
      titulo: '📝 Simulados',
      texto: 'Registre o gabarito por disciplina e veja a "Prioridade cirúrgica": o que mais cai × seu pior desempenho, pronto para atacar.' },
    { rota: 'stats', seletor: '#conteudo .stats-kpi-full, #conteudo .card',
      titulo: '📊 Desempenho',
      texto: 'Aqui você vê seu acerto geral vs. a meta, e logo abaixo o desempenho por disciplina e por tópico, horas estudadas e evolução — para saber exatamente onde focar.' },
    { rota: 'hoje', seletor: null,
      titulo: '🚀 Tudo pronto!',
      texto: 'Esse era o tour. Continue explorando o exemplo à vontade — nada é salvo. Quando quiser começar de verdade, é só entrar com sua conta e montar o seu plano.' }
  ];

  function iniciarTour() {
    if (tourAtivo) return;
    const jaNoDemo = modoDemo;
    entrarModoDemo(null, { silencioso: true, aoConcluir: function () {
      tourAtivo = true;
      tourPasso = 0;
      tourEntrouNoDemo = !jaNoDemo; // se já estávamos no demo (visitante), fica nele ao fim
      renderTourPasso();
    } });
  }

  function removerOverlayTour() {
    const el = document.getElementById('tour-overlay');
    if (el) el.remove();
  }

  function encerrarTour() {
    tourAtivo = false;
    removerOverlayTour();
    if (tourEntrouNoDemo) {
      // o tour ativou o demo (ex.: botão do Perfil numa conta real): volta ao real.
      modoDemo = false;
      state = window.Store.carregar();
      location.hash = state.plano ? '#hoje' : '#planos';
    } else {
      // visitante do modo exemplo: continua no demo, livre para explorar (nada é salvo).
      if (location.hash !== '#hoje') location.hash = '#hoje';
    }
    tourEntrouNoDemo = false;
    render();
  }

  function tourIr(delta) {
    const novo = tourPasso + delta;
    if (novo < 0) return;
    if (novo >= PASSOS_TOUR.length) { encerrarTour(); return; }
    tourPasso = novo;
    renderTourPasso();
  }

  function renderTourPasso() {
    if (!tourAtivo) return;
    const passo = PASSOS_TOUR[tourPasso];
    const rotaAlvo = '#' + passo.rota;
    if (location.hash !== rotaAlvo) { location.hash = rotaAlvo; }
    // espera o render da rota assentar antes de medir/posicionar o destaque
    setTimeout(function () { pintarTourPasso(passo); }, location.hash === rotaAlvo ? 60 : 180);
  }

  function pintarTourPasso(passo) {
    if (!tourAtivo) return;
    removerOverlayTour();
    const alvo = passo.seletor ? document.querySelector(passo.seletor) : null;
    // traz o alvo para a viewport (pode estar abaixo da dobra no mobile) antes de
    // medir — assim o destaque e o balão ficam visíveis.
    if (alvo && alvo.scrollIntoView) { try { alvo.scrollIntoView({ block: 'center' }); } catch (e) { alvo.scrollIntoView(); } }
    const rect = alvo ? alvo.getBoundingClientRect() : null;

    const overlay = document.createElement('div');
    overlay.id = 'tour-overlay';
    overlay.className = 'tour-overlay';

    const catch_ = document.createElement('div');
    catch_.className = 'tour-catch' + (rect ? '' : ' tour-catch-dim');
    overlay.appendChild(catch_);

    if (rect) {
      const pad = 6;
      const hole = document.createElement('div');
      hole.className = 'tour-hole';
      hole.style.left = (rect.left - pad) + 'px';
      hole.style.top = (rect.top - pad) + 'px';
      hole.style.width = (rect.width + pad * 2) + 'px';
      hole.style.height = (rect.height + pad * 2) + 'px';
      overlay.appendChild(hole);
    }

    const ehUltimo = tourPasso === PASSOS_TOUR.length - 1;
    const tip = document.createElement('div');
    tip.className = 'tour-tip';
    tip.innerHTML =
      '<h4>' + esc(passo.titulo) + '</h4>' +
      '<p>' + esc(passo.texto) + '</p>' +
      '<div class="tour-tip-acoes">' +
      '<span class="tour-passo-num">' + (tourPasso + 1) + '/' + PASSOS_TOUR.length + '</span>' +
      '<button type="button" class="botao-mini botao-quieto" data-tour="pular">Pular</button>' +
      (tourPasso > 0 ? '<button type="button" class="botao-mini botao-quieto" data-tour="anterior">Anterior</button>' : '') +
      '<button type="button" class="botao-mini" data-tour="proximo">' + (ehUltimo ? 'Concluir' : 'Próximo') + '</button>' +
      '</div>';
    overlay.appendChild(tip);
    document.body.appendChild(overlay);

    // posiciona o balão: abaixo do alvo se couber, senão acima; sem alvo, centraliza.
    const vh = window.innerHeight, vw = window.innerWidth;
    const th = tip.offsetHeight, tw = tip.offsetWidth;
    if (rect) {
      let top = rect.bottom + 12;
      if (top + th > vh - 12) top = Math.max(12, rect.top - th - 12);
      let left = rect.left + rect.width / 2 - tw / 2;
      left = Math.max(12, Math.min(left, vw - tw - 12));
      tip.style.top = top + 'px';
      tip.style.left = left + 'px';
    } else {
      tip.style.top = Math.max(12, (vh - th) / 2) + 'px';
      tip.style.left = Math.max(12, (vw - tw) / 2) + 'px';
    }

    overlay.querySelector('[data-tour="pular"]').addEventListener('click', encerrarTour);
    const ant = overlay.querySelector('[data-tour="anterior"]');
    if (ant) ant.addEventListener('click', function () { tourIr(-1); });
    overlay.querySelector('[data-tour="proximo"]').addEventListener('click', function () { tourIr(1); });
  }

  // Ao ENTRAR no modo exemplo: oferece o tour guiado (sempre disponível) ou deixa
  // a pessoa explorar livremente — nada é salvo de qualquer forma.
  function ofertarTourDemo() {
    if (tourAtivo) return;
    if (document.getElementById('modal-raiz').children.length) return;
    const m = abrirModal(
      '<div class="dialogo-icone" aria-hidden="true">🧭</div>' +
      '<h3>Modo exemplo</h3>' +
      '<p class="sub dialogo-msg">Este é um plano de demonstração — explore à vontade, <strong>nada é salvo</strong>. Quer um tour guiado de ~1 minuto pelas principais funções?</p>' +
      '<div class="modal-acoes"><button type="button" class="botao-quieto" id="tour-explorar">Explorar por conta</button>' +
      '<button type="button" id="tour-comecar">Fazer o tour</button></div>'
    );
    m.classList.add('modal-dialogo');
    m.querySelector('#tour-explorar').addEventListener('click', fecharModal);
    m.querySelector('#tour-comecar').addEventListener('click', function () { fecharModal(); iniciarTour(); });
  }

  // ---------------- inicialização ----------------
  window.addEventListener('hashchange', function () {
    fecharModal();
    window.scrollTo(0, 0);
    render();
  });
  // Botão/gesto "Voltar" do celular: pode disparar popstate sem hashchange (quando
  // o hash não muda). Garante que o modal aberto feche pelo caminho normal (que
  // descarta o plano-rascunho do assistente).
  window.addEventListener('popstate', function () {
    if (document.getElementById('modal-raiz') && document.getElementById('modal-raiz').innerHTML) fecharModal();
  });

  // Re-renderiza ao cruzar o breakpoint mobile/desktop (ex.: limite do painel
  // de disciplinas muda de 4 para 7), mantendo a tela coerente após resize.
  if (window.matchMedia) {
    const mqMobile = window.matchMedia('(max-width: 760px)');
    const aoMudarBreakpoint = function () { if (usuarioLogado()) render(); };
    if (mqMobile.addEventListener) mqMobile.addEventListener('change', aoMudarBreakpoint);
    else if (mqMobile.addListener) mqMobile.addListener(aoMudarBreakpoint);
  }

  document.addEventListener('click', function (e) {
    const link = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!link) return;
    const destino = link.getAttribute('href');
    if (!destino || destino === '#') return;
    e.preventDefault();
    fecharModal();
    if (location.hash === destino) render();
    else location.hash = destino;
  });

  // ---- Menu lateral: recolher com animação (desktop) / gaveta (celular) ----
  // O ☰ da SIDEBAR esconde o menu (que desliza para fora) e a marca "migra" para
  // o topbar; o ☰ do TOPBAR o traz de volta. No celular, o ☰ do topbar abre a
  // gaveta e o da sidebar a fecha.
  const CHAVE_SIDEBAR_RECOLHIDA = 'estudos.sidebarRecolhida';
  const botaoMenu = document.getElementById('botao-menu');
  const botaoMenuSb = document.getElementById('botao-menu-sb');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  function ehLarguraMobile() { return window.matchMedia('(max-width: 760px)').matches; }
  // Estado inicial: aplica a preferência salva SEM transição (classe sem-anim),
  // senão a lateral "desliza" sozinha a cada abertura do app.
  if (localStorage.getItem(CHAVE_SIDEBAR_RECOLHIDA) === '1') {
    document.body.classList.add('sem-anim');
    document.body.classList.add('sidebar-recolhida');
    if (botaoMenu) botaoMenu.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { document.body.classList.remove('sem-anim'); });
    });
  }
  function fecharGaveta() {
    document.body.classList.remove('sidebar-aberta');
  }
  function alternarMenu() {
    if (ehLarguraMobile()) {
      document.body.classList.toggle('sidebar-aberta');
    } else {
      const recolhida = document.body.classList.toggle('sidebar-recolhida');
      localStorage.setItem(CHAVE_SIDEBAR_RECOLHIDA, recolhida ? '1' : '0');
      // aria-expanded do ☰ do topbar = "há menu para mostrar?"
      if (botaoMenu) botaoMenu.setAttribute('aria-expanded', String(recolhida));
    }
  }
  if (botaoMenu) botaoMenu.addEventListener('click', alternarMenu);
  if (botaoMenuSb) botaoMenuSb.addEventListener('click', alternarMenu);
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', fecharGaveta);
  // Navegar pela gaveta a fecha; trocar para desktop também limpa o estado de gaveta.
  const sidebarEl = document.getElementById('sidebar');
  if (sidebarEl) sidebarEl.addEventListener('click', function (e) {
    if (e.target.closest('.nav-item, .sidebar-feedback')) fecharGaveta();
  });
  const sidebarFeedback = document.getElementById('sidebar-feedback');
  if (sidebarFeedback) sidebarFeedback.addEventListener('click', abrirFeedback);
  window.addEventListener('resize', function () { if (!ehLarguraMobile()) document.body.classList.remove('sidebar-aberta'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fecharGaveta(); });

  const botaoTema = document.getElementById('botao-tema');
  if (botaoTema) botaoTema.addEventListener('click', alternarTema);
  const botaoConfiguracoes = document.getElementById('botao-configuracoes');
  if (botaoConfiguracoes) botaoConfiguracoes.addEventListener('click', function (e) {
    e.preventDefault();
    fecharModal();
    if (location.hash === '#ajustes') render();
    else location.hash = '#ajustes';
  });
  const botaoPerfil = document.getElementById('botao-perfil');
  if (botaoPerfil) botaoPerfil.addEventListener('click', abrirPerfilUsuario);
  // A atualização de versão agora é automática e silenciosa (service worker no
  // index.html): sem card nem ação do usuário.
  // FAB speed-dial: toggle expande os atalhos rápidos (Desempenho / Timer).
  const fabRapido = document.getElementById('fab-rapido');
  const fabToggle = document.getElementById('fab-toggle');
  function fabFechar() {
    if (!fabRapido) return;
    fabRapido.setAttribute('data-aberto', 'false');
    if (fabToggle) fabToggle.setAttribute('aria-expanded', 'false');
  }
  function fabAlternar() {
    if (!fabRapido) return;
    const aberto = fabRapido.getAttribute('data-aberto') === 'true';
    fabRapido.setAttribute('data-aberto', aberto ? 'false' : 'true');
    if (fabToggle) fabToggle.setAttribute('aria-expanded', aberto ? 'false' : 'true');
  }
  if (fabToggle) fabToggle.addEventListener('click', function (e) { e.stopPropagation(); fabAlternar(); });
  const fabDesempenho = document.getElementById('fab-desempenho');
  if (fabDesempenho) fabDesempenho.addEventListener('click', function () { fabFechar(); location.hash = '#stats'; });
  const fabSimulados = document.getElementById('fab-simulados');
  if (fabSimulados) fabSimulados.addEventListener('click', function () { fabFechar(); location.hash = '#simulados'; });
  const fabTimer = document.getElementById('fab-timer');
  if (fabTimer) fabTimer.addEventListener('click', function () { fabFechar(); abrirTimerRapido(); });
  // fecha ao tocar fora ou apertar Esc
  document.addEventListener('click', function (e) {
    if (fabRapido && fabRapido.getAttribute('data-aberto') === 'true' && !fabRapido.contains(e.target)) fabFechar();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fabFechar(); });

  window.Timer.aoAtualizar(tratarTickTimer);

  // Ao sair do app (segundo plano) com o cronômetro rodando, o contador
  // aparece na bandeja; ao voltar, a notificação some (o relógio está na tela).
  document.addEventListener('visibilitychange', function () {
    const e = window.Timer.estado();
    if (document.hidden) { if (e && e.rodando) mostrarNotificacaoTimer(e, true); }
    else {
      limparNotificacaoTimer();
      if (usuarioLogado() && !modoDemo && disciplinasPausadasPlano().some(function (d) {
        return D.pausaDisciplinaExpirada(d, D.hojeISO());
      })) render();
    }
  });

  const recuperado = window.Timer.recuperar();
  // Antes de anunciar a recuperação: se o timer é de um plano que já não existe,
  // ele é descartado aqui mesmo (o toast do saneamento explica o que houve).
  const recuperadoOrfao = recuperado && sanearTimerOrfao();
  if (recuperado && !recuperadoOrfao) {
    toast('Timer recuperado em ' + window.Timer.formatar(recuperado.decorridoMs) + ' (pausado) — toque em retomar para continuar.', 'sucesso');
    if (!location.hash || location.hash === '#hoje') location.hash = '#timer';
  }
  const estadoInicialTimer = window.Timer.estado();
  atualizarTituloTimer(estadoInicialTimer);
  if (estadoInicialTimer && estadoInicialTimer.limiteAtingido) avisarLimiteTimer(estadoInicialTimer);

  // Cura planos antigos com a parede de revisões empilhadas (ponto de partida).
  // SEM marcar como alterado: carimbar atualizadoEm aqui faria uma cópia local
  // ANTIGA (aparelho parado há semanas) parecer "mais nova" que a nuvem e vencer
  // a reconciliação — foi assim que um plano velho engoliu o plano atual.
  if (migrarRevisoesEmPilha() > 0) window.Store.salvar(state, { marcarAlterado: false });

  render();

  // Se o Firebase não confirmar a sessão (offline/CDN bloqueado), libera os dados
  // locais do último usuário. Sem dados locais, cai na tela de login normalmente.
  setTimeout(function () {
    if (autenticacaoExpirou) return;
    autenticacaoExpirou = true;
    const ultimoUsuario = localStorage.getItem(CHAVE_ULTIMO_USUARIO);
    const estadoFirebase = firebaseStatus && firebaseStatus.estado;
    const firebaseIndisponivel = !window.FirebaseSync || navigator.onLine === false ||
      estadoFirebase === 'autenticando' || estadoFirebase === 'carregando' || estadoFirebase === 'erro';
    if (!usuarioLogado() && ultimoUsuario && window.Store.temDados(state) && firebaseIndisponivel) {
      modoOfflineLocal = true;
    }
    if (!usuarioLogado()) render();
    else if (modoOfflineLocal) render();
  }, 4000);

  const opcoesSyncBase = {
    obterEstado: function () { return state; },
    aplicarEstado: function (novoState, silencioso) {
      state = novoState;
      // Estado vindo do Firebase pode trazer a parede de revisões antiga: cura e
      // marca como alterado para ressincronizar o resultado.
      const curou = migrarRevisoesEmPilha() > 0;
      window.Store.salvar(state, { marcarAlterado: curou });
      // O plano pode ter sido excluído em OUTRO aparelho: revalida o cronômetro
      // com o estado recém-chegado da nuvem.
      sanearTimerOrfao({ silencioso: silencioso });
      render();
      if (!silencioso) toast('Dados sincronizados', 'sucesso');
    }
  };

  // O endpoint /api/sync é legado e não possui autenticação. Permanece disponível
  // só para desenvolvimento local com opt-in explícito; contas reais usam Firebase.
  const syncLocalOptIn = new URLSearchParams(location.search).get('syncLocal') === '1';
  if (window.Sync && syncLocalOptIn) {
    window.Sync.iniciar(Object.assign({}, opcoesSyncBase, {
      aoStatus: function (novoStatus) {
        syncStatus = novoStatus;
        atualizarSyncUi();
      }
    }));
  }

  function iniciarFirebaseSync() {
    if (!window.FirebaseSync || iniciarFirebaseSync.iniciado) return;
    iniciarFirebaseSync.iniciado = true;
    firebaseStatus = window.FirebaseSync.status();
    // Catálogo global é de leitura pública: carrega já no início (mesmo sem login)
    // para que visitantes e o modo exemplo vejam as imagens reais dos editais.
    carregarCatalogoGlobalFirebase();
    window.FirebaseSync.iniciar(Object.assign({}, opcoesSyncBase, {
      aoStatus: function (novoStatus) {
        const usuarioAntes = firebaseStatus && firebaseStatus.usuario ? firebaseStatus.usuario.email : null;
        const usuarioDepois = novoStatus && novoStatus.usuario ? novoStatus.usuario.email : null;
        // saiu do modo exemplo ao logar: descarta os dados de demonstração para não
        // poluir/sincronizar a conta real (reconciliação parte de um estado limpo).
        if (novoStatus && novoStatus.usuario && modoDemo && usuarioAntes !== usuarioDepois) {
          modoDemo = false;
          state = window.Store.estadoVazio();
          window.Store.salvar(state, { marcarAlterado: false });
        }
        if (novoStatus && novoStatus.usuario) {
          modoOfflineLocal = false;
          prepararEstadoParaUsuario(novoStatus.usuario);
        } else if (novoStatus && novoStatus.estado === 'deslogado' && navigator.onLine !== false) {
          modoOfflineLocal = false;
        }
        if (novoStatus && novoStatus.estado === 'sincronizado') syncInicialFeito = true;
        firebaseStatus = novoStatus;
        atualizarSyncUi();
        // NÃO publicar o catálogo automaticamente no login: o state ainda pode
        // estar vazio (sessão restaurando / saída do modo exemplo) e isso zerava
        // o catálogo global. A publicação agora é só ação explícita do admin
        // (salvar/excluir edital). Aqui apenas (re)carregamos o catálogo.
        if (novoStatus && novoStatus.usuario) {
          carregarCatalogoGlobalFirebase();
        }
        if (usuarioAntes !== usuarioDepois || !usuarioLogado()) render();
      }
    }));
  }
  window.addEventListener('firebase-sync-ready', iniciarFirebaseSync);
  iniciarFirebaseSync();
  // sem Firebase não há catálogo global a carregar: o catálogo (aba Planos) fica
  // indisponível offline de propósito; o resto do site continua funcionando.
  if (!window.FirebaseSync || !window.FirebaseSync.carregarCatalogoGlobal) catalogoGlobalCarregado = true;
})();
