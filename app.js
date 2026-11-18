/* Pedidos Unidad Dental — App instalable (PWA)
 * TONS: catálogo con fotos → carrito → solicitud a bodega dental → seguimiento.
 * Administradores: bandeja de bodega, corte mensual (planillas Droguería / Bodega Central), recepción de despachos,
 * catálogo AVIS, usuarios con vigencia y configuración.
 */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const LS = { get: (k, d) => { try { const v = localStorage.getItem('pd_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
               set: (k, v) => { try { localStorage.setItem('pd_' + k, JSON.stringify(v)); } catch (e) {} },
               del: k => { try { localStorage.removeItem('pd_' + k); } catch (e) {} } };
  const S = { token: LS.get('token', ''), usuario: LS.get('usuario', null), vista: '', carrito: LS.get('carrito', {}), catalogo: LS.get('catalogo', []),
              catTs: 0, cat: 'Todas', q: '', inicio: null, fotos: {}, filtro: {}, corte: null, cambiosCorte: {}, recep: null, cambiosRecep: {}, od: null, admin: null, instalar: null };
  const $ = s => document.querySelector(s);
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (v === null || v === undefined || v === '') ? '' : (Math.round(Number(v) * 100) / 100).toLocaleString('es-CL');
  const fecha = (iso, hora) => { if (!iso) return ''; const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/); if (!m) return iso; return m[3] + '/' + m[2] + '/' + m[1] + (hora && m[4] ? ' ' + m[4] + ':' + m[5] : ''); };
  const hoyISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const esAdmin = () => S.usuario && S.usuario.rol === 'ADMIN';
  const puede = p => !!(S.usuario && (S.usuario.permisos || (S.usuario.rol === 'ADMIN' ? ['PEDIR', 'SOLICITUDES', 'RECEPCION', 'CORTE', 'CATALOGO', 'REPORTES', 'PLAZOS'] : ['PEDIR'])).includes(p));
  const esGestor = () => S.usuario && S.usuario.rol !== 'USUARIO';
  const ROL_NOMBRE = { ADMIN: 'Administrador', BODEGA: 'Encargada de bodega', USUARIO: 'Usuario' };

  /* ---------------- Comunicación con Apps Script ---------------- */
  let pendientes = 0;
  function cargando(on) {
    pendientes += on ? 1 : -1;
    let el = $('#cargando');
    if (pendientes > 0 && !el) { el = document.createElement('div'); el.id = 'cargando'; el.className = 'cargando'; el.innerHTML = '<div><div class="spinner"></div><div class="muted">Procesando…</div></div>'; document.body.appendChild(el); }
    if (pendientes <= 0 && el) { el.remove(); pendientes = 0; }
  }
  async function api(accion, datos, opt) {
    opt = opt || {};
    if (!CFG.API_URL || /PEGAR_AQUI/.test(CFG.API_URL)) throw new Error('La app no está configurada: falta la URL de Apps Script en config.js.');
    if (!opt.silencioso) cargando(true);
    try {
      const r = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ accion, token: S.token, datos: datos || {} }) });
      const j = await r.json();
      if (!j.ok) {
        if (/SESION_INVALIDA/.test(j.error)) { cerrarSesionLocal(); toast(j.error.replace('SESION_INVALIDA', 'Su sesión terminó').replace(/^: /, ''), true); throw new Error('_sesion'); }
        if (/CAMBIO_CLAVE_REQUERIDO/.test(j.error)) { S.usuario.debe_cambiar_clave = 'SI'; LS.set('usuario', S.usuario); render(); throw new Error('_clave'); }
        throw new Error(j.error);
      }
      return j.datos;
    } catch (e) {
      if (e.message === '_sesion' || e.message === '_clave') throw e;
      if (e instanceof TypeError) throw new Error('Sin conexión con el servidor. Revise su internet e intente nuevamente.');
      throw e;
    } finally { if (!opt.silencioso) cargando(false); }
  }
  function toast(msg, error) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (error ? ' error' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.className = 'toast oculto', error ? 6000 : 3000);
  }
  async function intentar(fn) { try { return await fn(); } catch (e) { if (e.message !== '_sesion' && e.message !== '_clave') toast(e.message, true); } }
  function modal(html) { const m = $('#modal'); m.innerHTML = '<div class="caja">' + html + '</div>'; m.classList.remove('oculto'); m.onclick = e => { if (e.target === m) cerrarModal(); }; }
  function cerrarModal() { const m = $('#modal'); m.classList.add('oculto'); m.innerHTML = ''; }
  function leerArchivo(file) { return new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = mal; r.readAsDataURL(file); }); }
  async function reducirImagen(file) {
    const url = await leerArchivo(file);  // File o Blob
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error('No se pudo leer la imagen.')); i.src = url; });
    let lado = 640, q = 0.8, out = '';
    for (let k = 0; k < 12; k++) {
      const esc_ = Math.min(1, lado / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * esc_); c.height = Math.round(img.height * esc_);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL('image/jpeg', q);
      if (out.length < 45000) return out;
      if (q > 0.5) q -= 0.1; else lado = Math.round(lado * 0.82);
    }
    return out;
  }

  /* ---------------- Sesión ---------------- */
  function cerrarSesionLocal() { S.token = ''; S.usuario = null; S.inicio = null; LS.del('token'); LS.del('usuario'); render(); }
  async function login(e) {
    e.preventDefault();
    const usuario = $('#lu').value.trim(), clave = $('#lc').value;
    await intentar(async () => {
      const r = await api('login', { usuario, clave });
      S.token = r.token; S.usuario = r.usuario; LS.set('token', r.token); LS.set('usuario', r.usuario);
      S.vista = navItems()[0][0];
      render();
    });
  }
  async function logout() {
    try { await api('logout', {}, { silencioso: true }); } catch (e) {}
    cerrarSesionLocal();
  }
  async function cambiarClave(e) {
    e.preventDefault();
    const actual = $('#ca').value, nueva = $('#cn').value, rep = $('#cr').value;
    if (nueva !== rep) return toast('La nueva clave y su repetición no coinciden.', true);
    await intentar(async () => {
      await api('cambiarClave', { actual, nueva });
      S.usuario.debe_cambiar_clave = 'NO'; LS.set('usuario', S.usuario); cerrarModal();
      toast('Clave actualizada.'); render();
    });
  }
  function formClave(obligatorio) {
    return `<form onsubmit="App.cambiarClave(event)">
      ${obligatorio ? '<p class="muted">Por seguridad, cree una clave personal antes de continuar. Use al menos 6 caracteres combinando letras y números.</p>' : ''}
      <label>Clave actual${obligatorio ? ' (la temporal que le entregaron)' : ''}</label><input id="ca" type="password" autocomplete="current-password" required>
      <label>Nueva clave</label><input id="cn" type="password" autocomplete="new-password" required minlength="6">
      <label>Repita la nueva clave</label><input id="cr" type="password" autocomplete="new-password" required minlength="6">
      <p><button class="btn bloque">Guardar clave</button></p></form>`;
  }

  /* ---------------- Estructura ---------------- */
  const NAV_USUARIO = [['catalogo', '🦷', 'Pedir'], ['carrito', '🛒', 'Carrito'], ['mis', '📋', 'Mis pedidos'], ['perfil', '👤', 'Perfil']];
  function navItems() {
    if (!esGestor()) return NAV_USUARIO;
    const l = [];
    if (puede('SOLICITUDES')) l.push(['bandeja', '📥', 'Solicitudes']);
    if (puede('CORTE')) l.push(['corte', '📊', 'Corte']);
    if (puede('RECEPCION')) l.push(['recepcion', '🚚', 'Recepción']);
    if (puede('CATALOGO')) l.push(['catadmin', '🗂️', 'Catálogo']);
    if (l.length < 4 && puede('PEDIR')) l.push(['catalogo', '🦷', 'Pedir']);
    l.push(['mas', '☰', 'Más']);
    return l;
  }
  const TITULOS = { catalogo: 'Solicitar insumos', carrito: 'Mi solicitud', mis: 'Mis pedidos', perfil: 'Mi perfil', bandeja: 'Solicitudes a bodega', corte: 'Corte y pedidos',
    recepcion: 'Recepción de despachos', catadmin: 'Catálogo AVIS', usuarios: 'Usuarios y permisos', config: 'Configuración', mas: 'Más opciones',
    plazos: 'Plazos de pedido', reportes: 'Consumo y cumplimiento' };

  function render() {
    const app = $('#app');
    if (!S.token || !S.usuario) {
      app.innerHTML = `<div class="login"><div class="tarjeta"><img src="icons/icon-192.png" alt=""><h1>${esc(CFG.NOMBRE || 'Pedidos Dental')}</h1>
        <p class="muted">${esc(CFG.UNIDAD || '')}</p>
        <form onsubmit="App.login(event)"><label>Usuario</label><input id="lu" type="text" autocomplete="username" autocapitalize="none" required>
        <label>Clave</label><input id="lc" type="password" autocomplete="current-password" required>
        <p><button class="btn bloque">Ingresar</button></p></form>
        <p class="muted pequeno">¿Olvidó su clave? Pida a un administrador que la restablezca.</p></div></div>`;
      return;
    }
    if (S.usuario.debe_cambiar_clave === 'SI') {
      app.innerHTML = `<div class="login"><div class="tarjeta"><img src="icons/icon-192.png" alt=""><h1>Cree su clave</h1><p class="muted">${esc(S.usuario.nombre)}</p>${formClave(true)}
        <p><button class="btn sec bloque" onclick="App.logout()">Salir</button></p></div></div>`;
      return;
    }
    const nav = navItems();
    if (!S.vista) S.vista = nav[0][0];
    const nCarro = Object.keys(S.carrito).length;
    const badge = v => v === 'carrito' && nCarro ? `<span class="badge">${nCarro}</span>` : (v === 'bandeja' && S.inicio && S.inicio.pendientes ? `<span class="badge">${S.inicio.pendientes}</span>` : '');
    const enNav = nav.map(n => n[0]);
    const activo = v => (S.vista === v || (v === 'mas' && !enNav.includes(S.vista) && esGestor()) ? 'activo' : '');
    app.innerHTML = `<header class="top"><h1>${esc(TITULOS[S.vista] || '')}<span class="sub">${esc(S.usuario.nombre)}${esGestor() ? ' · ' + ROL_NOMBRE[S.usuario.rol] : ''}</span></h1>
      <button onclick="App.refrescar()" title="Actualizar">⟳</button></header>
      <main id="vista"></main>
      <nav class="abajo">${nav.map(n => `<button class="${activo(n[0])}" onclick="App.ir('${n[0]}')"><span class="i">${n[1]}</span>${n[2]}${badge(n[0])}</button>`).join('')}</nav>`;
    const fn = VISTAS[S.vista]; if (fn) fn();
  }
  function ir(v) { S.vista = v; window.scrollTo(0, 0); render(); }
  function refrescar() { S.catTs = 0; S.inicio = null; render(); cargarInicio(); }
  async function cargarInicio() {
    try { S.inicio = await api('inicio', {}, { silencioso: true }); S.usuario = S.inicio.usuario; LS.set('usuario', S.usuario); if (puede('SOLICITUDES')) actualizarBadges(); pintarBannerPlazo(); } catch (e) {}
  }
  function actualizarBadges() {
    const b = document.querySelector('nav.abajo button:first-child'); if (!b || !S.inicio) return;
    const x = b.querySelector('.badge'); if (x) x.remove();
    if (S.inicio.pendientes) b.insertAdjacentHTML('beforeend', `<span class="badge">${S.inicio.pendientes}</span>`);
  }
  const V = html => { const v = $('#vista'); if (v) v.innerHTML = html; };

  /* ================= TONS: catálogo y carrito ================= */
  async function vCatalogo() {
    if (!S.catalogo.length || Date.now() - S.catTs > 600000) {
      V('<div class="vacio"><div class="spinner"></div>Cargando catálogo…</div>');
      await intentar(async () => { S.catalogo = await api('catalogo', {}, { silencioso: true }); S.catTs = Date.now(); LS.set('catalogo', S.catalogo); });
      if (S.vista !== 'catalogo') return;
    }
    const cats = ['Todas'].concat([...new Set(S.catalogo.map(p => p.categoria))].sort());
    if (!S.inicio) cargarInicio();
    V(`<div id="bannerPlazo">${bannerPlazo()}</div><div class="buscador"><input type="search" id="q" placeholder="Buscar producto (ej: guante, composite, lima)…" value="${esc(S.q)}" oninput="App.buscar(this.value)">
      <div class="chips" style="margin-top:8px">${cats.map(c => `<button class="chip ${S.cat === c ? 'activo' : ''}" onclick="App.categoria('${esc(c)}')">${esc(c)}</button>`).join('')}</div></div>
      <div id="lista"></div><div id="carroFlot"></div>`);
    pintarLista(); pintarCarroFlotante();
  }
  const fh = iso => fecha(iso, true).replace(/\/\d{4}/, '');
  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const dia = iso => { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? DIAS[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] + ' ' : ''; };
  function bannerPlazo() {
    const p = S.inicio && S.inicio.plazo;
    if (!p || !p.control) return '';
    if (p.en_plazo === 'SI') return `<div class="tarjeta" style="border-left:5px solid var(--verde);border-radius:0 12px 12px 0;padding:10px 14px"><b style="color:var(--verde)">Plazo abierto</b> · ${esc(p.actual.nombre)}<br><span class="muted">Envíe su solicitud antes del <b>${dia(p.actual.cierre)}${fh(p.actual.cierre)}</b></span></div>`;
    return `<div class="tarjeta" style="border-left:5px solid var(--rojo);border-radius:0 12px 12px 0;padding:10px 14px"><b style="color:var(--rojo)">Fuera de plazo</b>${p.proximo ? `<br><span class="muted">Próximo plazo: abre el ${dia(p.proximo.apertura)}${fh(p.proximo.apertura)} y cierra el ${dia(p.proximo.cierre)}${fh(p.proximo.cierre)}</span>` : ''}
      <br><span class="pequeno">${p.modo === 'BLOQUEAR' ? 'Solo se aceptan solicitudes <b>urgentes</b> con el motivo escrito.' : 'Puede enviar igual, pero la solicitud quedará registrada <b>fuera de plazo</b>.'}</span></div>`;
  }
  function pintarBannerPlazo() { const b = $('#bannerPlazo'); if (b) b.innerHTML = bannerPlazo(); }

  function normal(s) { return String(s).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function pintarLista() {
    const q = normal(S.q).split(/\s+/).filter(Boolean);
    const l = S.catalogo.filter(p => (S.cat === 'Todas' || p.categoria === S.cat) && q.every(w => normal(p.nombre).includes(w)));
    const el = $('#lista'); if (!el) return;
    el.innerHTML = l.length ? l.slice(0, 250).map(p => {
      const c = S.carrito[p.id] ? S.carrito[p.id].cantidad : 0;
      return `<div class="producto">${p.foto ? `<button class="foto-btn" onclick="App.verFoto('${p.id}')" title="Ver foto">📷</button>` : ''}
        <div class="nom">${esc(p.nombre)}<small>${esc(p.categoria)}</small></div>
        <div class="stepper"><button onclick="App.sumar('${p.id}',-1)" aria-label="Menos">−</button><input inputmode="numeric" value="${c || ''}" placeholder="0" onchange="App.fijar('${p.id}',this.value)"><button onclick="App.sumar('${p.id}',1)" aria-label="Más">+</button></div></div>`;
    }).join('') + (l.length > 250 ? '<p class="muted">Afine la búsqueda para ver más productos.</p>' : '') : '<div class="vacio">No hay productos con ese criterio.</div>';
  }
  function pintarCarroFlotante() {
    const el = $('#carroFlot'); if (!el) return;
    const n = Object.keys(S.carrito).length;
    el.innerHTML = n ? `<div class="carro-flotante"><button class="btn ok bloque" onclick="App.ir('carrito')">🛒 Revisar solicitud (${n} producto${n > 1 ? 's' : ''})</button></div>` : '';
    const b = esGestor() ? null : [...document.querySelectorAll('nav.abajo button')][1];
    if (b) { const x = b.querySelector('.badge'); if (x) x.remove(); if (n) b.insertAdjacentHTML('beforeend', `<span class="badge">${n}</span>`); }
  }
  function fijar(id, v) {
    const p = S.catalogo.find(x => x.id === id) || (S.carrito[id] && S.carrito[id].p);
    let c = Math.max(0, Math.min(100000, parseInt(v, 10) || 0));
    if (c) S.carrito[id] = { p: { id: p.id, nombre: p.nombre, categoria: p.categoria, foto: p.foto }, cantidad: c }; else delete S.carrito[id];
    LS.set('carrito', S.carrito);
    if (S.vista === 'catalogo') { pintarLista(); pintarCarroFlotante(); } else render();
  }
  function sumar(id, d) { fijar(id, (S.carrito[id] ? S.carrito[id].cantidad : 0) + d); }
  async function verFoto(id) {
    const p = S.catalogo.find(x => x.id === id) || { nombre: '' };
    modal(`<h2>${esc(p.nombre)}</h2><img class="foto" id="fotoImg" alt="Foto del producto"><p><button class="btn sec bloque" onclick="App.cerrarModal()">Cerrar</button></p>`);
    let data = S.fotos[id] || LS.get('foto_' + id, '');
    if (!data) await intentar(async () => { data = (await api('foto', { producto_id: id }, { silencioso: true })).data; });
    if (data) { S.fotos[id] = data; LS.set('foto_' + id, data); const i = $('#fotoImg'); if (i) i.src = data; }
    else { const i = $('#fotoImg'); if (i) i.replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Este producto aún no tiene foto.' })); }
  }

  function vCarrito() {
    const items = Object.values(S.carrito);
    if (!items.length) return V('<div class="vacio">Su solicitud está vacía.<br><br><button class="btn" onclick="App.ir(\'catalogo\')">Ir al catálogo</button></div>');
    const boxes = (S.inicio && S.inicio.boxes) || [];
    const pz = S.inicio && S.inicio.plazo, bloqueo = pz && pz.control && pz.en_plazo === 'NO' && pz.modo === 'BLOQUEAR';
    V(`<div id="bannerPlazo">${bannerPlazo()}</div><div class="tarjeta"><h2>Productos (${items.length})</h2>
      ${items.map(i => `<div class="producto" style="box-shadow:none;border:1px solid var(--borde)"><div class="nom">${esc(i.p.nombre)}</div>
        <div class="stepper"><button onclick="App.sumar('${i.p.id}',-1)">−</button><input inputmode="numeric" value="${i.cantidad}" onchange="App.fijar('${i.p.id}',this.value)"><button onclick="App.sumar('${i.p.id}',1)">+</button></div></div>`).join('')}
      <p class="muted pequeño">Las cantidades son en la unidad con que bodega registra en AVIS (unidades sueltas: guantes, tubos, tórulas).</p></div>
      <div class="tarjeta"><h2>Datos de la solicitud</h2>
        <label>Lugar de entrega</label><select id="sbox">${boxes.map(b => `<option>${esc(b)}</option>`).join('')}<option value="">Otro / sin especificar</option></select>
        <label>Prioridad</label><select id="sprio">${bloqueo ? '' : '<option value="NORMAL">Normal</option>'}<option value="URGENTE">Urgente (se necesita hoy)</option></select>
        <label>${bloqueo ? 'Motivo de la urgencia (obligatorio fuera de plazo)' : 'Comentario para bodega (opcional)'}</label><textarea id="scom" maxlength="500" placeholder="Ej: para atención de urgencia del box 12"></textarea>
        <p><button class="btn ok bloque" onclick="App.enviarSolicitud()">Enviar solicitud a bodega</button></p>
        <p><button class="btn sec bloque" onclick="App.vaciarCarrito()">Vaciar</button></p></div>`);
    if (!S.inicio) cargarInicio().then(() => { if (S.vista === 'carrito' && S.inicio) { const sel = $('#sbox'); if (sel && sel.options.length < 2) vCarrito(); } });
  }
  function vaciarCarrito() { if (confirm('¿Vaciar la solicitud?')) { S.carrito = {}; LS.set('carrito', {}); render(); } }
  async function enviarSolicitud() {
    const items = Object.values(S.carrito).map(i => ({ producto_id: i.p.id, cantidad: i.cantidad }));
    await intentar(async () => {
      const r = await api('crearSolicitud', { items, box: $('#sbox').value, prioridad: $('#sprio').value, comentario: $('#scom').value });
      S.carrito = {}; LS.set('carrito', {});
      toast('Solicitud ' + r.id + ' enviada a bodega' + (r.en_plazo === 'NO' ? ' (fuera de plazo).' : '.')); S.vista = 'mis'; render();
    });
  }

  const COLOR_EST = { PENDIENTE: 'e-amarillo', ENTREGADA: 'e-verde', PARCIAL: 'e-azul', RECHAZADA: 'e-rojo', ANULADA: 'e-gris' };
  function tarjetaSolicitud(s, admin) {
    return `<div class="tarjeta"><div class="fila entre"><b>${esc(s.id)}</b><span class="estado ${COLOR_EST[s.estado] || 'e-gris'}">${esc(s.estado)}</span></div>
      <div class="muted">${fecha(s.fecha, true)}${admin ? ' · <b>' + esc(s.nombre) + '</b>' : ''}${s.box ? ' · ' + esc(s.box) : ''}${s.prioridad === 'URGENTE' ? ' · <span class="estado e-rojo">URGENTE</span>' : ''}${s.en_plazo === 'SI' ? ' · <span class="estado e-verde">En plazo</span>' : (s.en_plazo === 'NO' ? ' · <span class="estado e-amarillo">Fuera de plazo</span>' : '')}</div>
      ${s.comentario ? `<p class="muted">“${esc(s.comentario)}”</p>` : ''}
      ${s.items.map(i => `<div class="item-sol"><span>${esc(i.nombre)}</span><span><b>${i.solicitada}</b>${i.entregada !== null ? ' → entregado ' + i.entregada : ''}</span></div>`).join('')}
      ${s.fecha_atencion ? `<p class="muted pequeno">Atendida por ${esc(s.atendido_por)} el ${fecha(s.fecha_atencion, true)}${s.obs_bodega ? ': ' + esc(s.obs_bodega) : ''}</p>` : ''}
      ${admin ? botonesBandeja(s) : (s.estado === 'PENDIENTE' ? `<button class="btn peligro chico" onclick="App.anular('${s.id}')">Anular solicitud</button>` : '')}</div>`;
  }
  async function vMis() {
    V('<div class="vacio"><div class="spinner"></div></div>');
    await intentar(async () => {
      const l = await api('misSolicitudes', {}, { silencioso: true });
      if (S.vista !== 'mis') return;
      V(l.length ? l.map(s => tarjetaSolicitud(s, false)).join('') : '<div class="vacio">Aún no ha realizado solicitudes.</div>');
    });
  }
  async function anular(id) { if (!confirm('¿Anular la solicitud ' + id + '?')) return; await intentar(async () => { await api('anularSolicitud', { id }); toast('Solicitud anulada.'); render(); }); }

  function vPerfil() {
    const u = S.usuario;
    const vig = { INDEFINIDO: ['e-verde', 'Indefinido'], VIGENTE: ['e-verde', 'Vigente hasta ' + fecha(u.fecha_termino)], POR_VENCER: ['e-amarillo', 'Vence el ' + fecha(u.fecha_termino) + ' (' + u.dias_vigencia + ' días)'] }[u.vigencia] || ['e-gris', u.vigencia];
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
    V(`<div class="tarjeta"><h2>${esc(u.nombre)}</h2><div class="muted">Usuario: <b>${esc(u.usuario)}</b>${u.cargo ? ' · ' + esc(u.cargo) : ''}</div>
      <p>Acceso: <span class="estado ${vig[0]}">${esc(vig[1])}</span></p></div>
      ${S.instalar ? '<div class="tarjeta"><h2>Instalar la app</h2><p class="muted">Instálela para abrirla desde su pantalla de inicio como cualquier aplicación.</p><button class="btn bloque" onclick="App.instalarApp()">Instalar en este teléfono</button></div>' : ''}
      ${ios ? '<div class="tarjeta"><h2>Instalar en iPhone</h2><p class="muted">En Safari toque <b>Compartir</b> (cuadro con flecha) y luego <b>Agregar a pantalla de inicio</b>.</p></div>' : ''}
      <div class="tarjeta"><h2>Cambiar clave</h2>${formClave(false)}</div>
      <button class="btn peligro bloque" onclick="App.logout()">Cerrar sesión</button>`);
  }

  /* ================= ADMIN: bandeja de bodega ================= */
  function botonesBandeja(s) {
    let h = '<div class="fila" style="margin-top:8px">';
    if (s.estado === 'PENDIENTE') h += `<button class="btn chico" onclick="App.atender('${s.id}')">Atender / entregar</button>`;
    if ((s.estado === 'ENTREGADA' || s.estado === 'PARCIAL') && s.avis_registrado !== 'SI') h += `<button class="btn ok chico" onclick="App.marcarAvis('${s.id}')">✓ Ya rebajé en AVIS</button><span class="estado e-amarillo">Falta rebajar en AVIS</span>`;
    if (s.avis_registrado === 'SI') h += '<span class="estado e-verde">Rebajado en AVIS</span>';
    return h + '</div>';
  }
  async function vBandeja() {
    const f = S.filtro.bandeja || 'ABIERTAS';
    if (!S.inicio) cargarInicio().then(() => { if (S.vista === 'bandeja') pintarKpis(); });
    V(`<div id="kpis"></div><div class="chips" style="margin-bottom:10px">${[['ABIERTAS', 'Por atender'], ['PENDIENTE', 'Pendientes'], ['ENTREGADA', 'Entregadas'], ['PARCIAL', 'Parciales'], ['RECHAZADA', 'Rechazadas'], ['TODAS', 'Todas']].map(x =>
      `<button class="chip ${f === x[0] ? 'activo' : ''}" onclick="App.filtrar('bandeja','${x[0]}')">${x[1]}</button>`).join('')}</div><div id="lb"><div class="vacio"><div class="spinner"></div></div></div>`);
    pintarKpis();
    await intentar(async () => {
      S.bandeja = await api('bandeja', { estado: f }, { silencioso: true });
      if (S.vista !== 'bandeja') return;
      $('#lb').innerHTML = S.bandeja.length ? S.bandeja.map(s => tarjetaSolicitud(s, true)).join('') : '<div class="vacio">No hay solicitudes en esta vista. 👍</div>';
    });
  }
  function pintarKpis() {
    const el = $('#kpis'); if (!el || !S.inicio) return;
    const i = S.inicio;
    el.innerHTML = `<div class="kpis"><div class="kpi"><b>${i.pendientes || 0}</b><span>Solicitudes pendientes</span></div><div class="kpi"><b>${i.sin_avis || 0}</b><span>Entregadas sin rebajar en AVIS</span></div>
      ${esAdmin() ? `<div class="kpi"><b>${i.por_vencer || 0}</b><span>Accesos por vencer (30 días)</span></div><div class="kpi"><b>${i.vencidos || 0}</b><span>Accesos vencidos</span></div>` : ''}</div>`;
  }
  function atender(id) {
    const s = S.bandeja.find(x => x.id === id);
    modal(`<h2>Atender ${esc(s.id)}</h2><p class="muted">${esc(s.nombre)} · ${fecha(s.fecha, true)}${s.box ? ' · ' + esc(s.box) : ''}</p>
      <p class="muted pequeno">Indique la cantidad realmente entregada de cada producto (0 si no hay).</p>
      ${s.items.map((i, k) => `<div class="producto" style="box-shadow:none;border:1px solid var(--borde)"><div class="nom">${esc(i.nombre)}<small>Solicitado: ${i.solicitada}</small></div>
        <input class="num" style="width:90px;text-align:right" type="number" min="0" step="1" id="ent${k}" value="${i.solicitada}"></div>`).join('')}
      <label>Observación para quien solicitó (opcional)</label><input type="text" id="aobs" maxlength="500" placeholder="Ej: no queda stock de vinilo M">
      <label class="check"><input type="checkbox" id="aavis"> Ya rebajé esta entrega en AVIS (módulo farmacia)</label>
      <div class="fila"><button class="btn ok col" onclick="App.confirmarAtencion('${s.id}')">Registrar entrega</button><button class="btn peligro col" onclick="App.rechazar('${s.id}')">Rechazar todo</button></div>
      <p><button class="btn sec bloque" onclick="App.cerrarModal()">Cancelar</button></p>`);
  }
  async function confirmarAtencion(id, rechazo) {
    const s = S.bandeja.find(x => x.id === id);
    const items = s.items.map((i, k) => ({ producto_id: i.producto_id, entregada: rechazo ? 0 : ($('#ent' + k).value || 0) }));
    await intentar(async () => {
      const r = await api('atenderSolicitud', { id, items, obs: $('#aobs').value, avis_registrado: !rechazo && $('#aavis').checked });
      cerrarModal(); toast('Solicitud ' + id + ': ' + r.estado); S.inicio = null; cargarInicio(); vBandeja();
    });
  }
  async function marcarAvis(id) { await intentar(async () => { await api('marcarAvis', { id }); toast('Marcada como rebajada en AVIS.'); S.inicio = null; cargarInicio(); vBandeja(); }); }

  /* ================= ADMIN: corte ================= */
  async function vCorte() {
    if (S.corte) return pintarCorte();
    V('<div class="vacio"><div class="spinner"></div></div>');
    await intentar(async () => {
      const [imps, cortes] = await Promise.all([api('importesAvis', {}, { silencioso: true }), api('cortes', {}, { silencioso: true })]);
      if (S.vista !== 'corte') return;
      const ult = imps[0];
      V(`<div class="tarjeta"><h2>1. Importar informe AVIS del período</h2>
        <p class="muted">En AVIS abra <b>Reportes → Farmacia → Informe Completo de Productos</b> de la bodega dental, seleccione el período, presione <b>Ctrl+A</b> y <b>Ctrl+C</b>, y pegue aquí. También puede subir el PDF del informe.</p>
        <textarea id="avisTxt" placeholder="Pegue aquí el informe completo de AVIS…"></textarea>
        <div class="fila"><div class="col"><label>O suba el PDF del informe</label><input type="file" id="avisPdf" accept="application/pdf"></div></div>
        <div class="fila"><div class="col"><label>Desde (si no viene en el informe)</label><input type="date" id="avDesde"></div><div class="col"><label>Hasta</label><input type="date" id="avHasta"></div></div>
        <p><button class="btn" onclick="App.importarAvis()">Importar informe</button></p>
        ${ult ? `<p class="muted">Último informe: ${fecha(ult.desde)} al ${fecha(ult.hasta)} · ${ult.n_productos} productos · importado ${fecha(ult.fecha, true)} por ${esc(ult.usuario)}${ult.n_sin_catalogo ? ` · <span class="estado e-amarillo">${ult.n_sin_catalogo} productos nuevos agregados al catálogo</span>` : ''}</p>` : ''}</div>
        <div class="tarjeta"><h2>2. Generar corte (borrador editable)</h2>
        ${ult ? `<div class="fila"><div class="col"><label>Informe AVIS</label><select id="ctImp">${imps.map(i => `<option value="${i.id}">${fecha(i.desde)} al ${fecha(i.hasta)} (${i.id})</option>`).join('')}</select></div>
          <div class="col"><label>% de seguridad sobre el consumo</label><input type="number" id="ctSeg" min="0" max="300" placeholder="Según configuración (20 %)"></div></div>
          <p class="muted pequeno">Pedido sugerido = consumo × (1 + % seguridad) − saldo, redondeado hacia arriba y nunca negativo. Consumo y saldo se convierten a la unidad de cada planilla (ej. guantes en cajas de 100).</p>
          <p><button class="btn" onclick="App.crearCorte()">Generar corte</button></p>` : '<p class="muted">Primero importe un informe AVIS.</p>'}</div>
        <div class="tarjeta"><h2>Cortes anteriores</h2>${cortes.length ? cortes.map(c => `<div class="item-sol"><span><b>${esc(c.id)}</b> · ${fecha(c.desde)} al ${fecha(c.hasta)}<br><span class="muted pequeno">Creado ${fecha(c.creado, true)} por ${esc(c.creado_por)}</span></span>
          <span><span class="estado ${{ BORRADOR: 'e-amarillo', CONFORME: 'e-azul', ENVIADO_PARCIAL: 'e-azul', ENVIADO_TODO: 'e-verde' }[c.estado] || 'e-gris'}">${esc(c.estado.replace('_', ' '))}</span><br><button class="btn sec chico" style="margin-top:4px" onclick="App.abrirCorte('${c.id}')">Abrir</button></span></div>`).join('') : '<p class="muted">Sin cortes aún.</p>'}</div>`);
    });
  }
  async function importarAvis() {
    const texto = $('#avisTxt').value.trim(), file = $('#avisPdf').files[0];
    if (!texto && !file) return toast('Pegue el informe o seleccione el PDF.', true);
    const d = { texto, desde: $('#avDesde').value, hasta: $('#avHasta').value };
    if (!texto && file) { if (file.size > 15e6) return toast('El archivo supera 15 MB.', true); d.archivo = { nombre: file.name, mime: file.type, data: await leerArchivo(file) }; }
    await intentar(async () => {
      const r = await api('importarAvis', d);
      modal(`<h2>Informe importado</h2><p>Período <b>${fecha(r.desde)} al ${fecha(r.hasta)}</b>${r.bodega ? '<br><span class="muted">' + esc(r.bodega) + '</span>' : ''}</p>
        <div class="kpis"><div class="kpi"><b>${r.filas}</b><span>filas leídas</span></div><div class="kpi"><b>${r.con_consumo}</b><span>con consumo</span></div><div class="kpi"><b>${r.con_saldo}</b><span>con saldo</span></div></div>
        ${r.nuevos && r.nuevos.length ? `<p><span class="estado e-amarillo">${r.nuevos.length} productos no estaban en el catálogo</span> y se agregaron ocultos para revisión (Catálogo → filtro "Revisar"):</p><p class="muted pequeno">${r.nuevos.map(esc).join('<br>')}</p>` : '<p class="estado e-verde">Todos los nombres coinciden con el catálogo.</p>'}
        ${r.no_leidas && r.no_leidas.length ? `<p class="muted">Líneas no reconocidas (revise si falta algo):</p><p class="muted pequeno">${r.no_leidas.map(esc).join('<br>')}</p>` : ''}
        <p><button class="btn bloque" onclick="App.cerrarModal();App.ir('corte')">Continuar</button></p>`);
    });
  }
  async function crearCorte() {
    await intentar(async () => {
      S.corte = await api('crearCorte', { importe_id: $('#ctImp').value, seguridad: $('#ctSeg').value });
      S.cambiosCorte = {}; S.filtro.corteTab = 'FARMACIA'; pintarCorte();
    });
  }
  async function abrirCorte(id) { await intentar(async () => { S.corte = await api('corte', { id }); S.cambiosCorte = {}; S.filtro.corteTab = S.filtro.corteTab || 'FARMACIA'; pintarCorte(); }); }
  function pintarCorte() {
    const c = S.corte, tab = S.filtro.corteTab || 'FARMACIA', soloPed = S.filtro.soloPedido, edit = c.estado === 'BORRADOR';
    const items = c.items.filter(i => i.planilla === tab);
    const tot = pl => c.items.filter(i => i.planilla === pl && i.pedido > 0).length;
    const nCambios = Object.keys(S.cambiosCorte).length;
    let filas = '', sec = null;
    items.forEach(i => {
      if (tab === 'BODEGA' && i.seccion !== sec) { sec = i.seccion; filas += `<tr class="seccion"><td colspan="9">${esc(sec)}</td></tr>`; }
      if (soloPed && !(i.pedido > 0)) return;
      const k = i.planilla + '|' + i.fila, ch = S.cambiosCorte[k] || {};
      const val = f => ch[f] !== undefined ? ch[f] : (i[f] === null ? '' : i[f]);
      const inp = (f, cls) => edit ? `<input class="${cls || 'num'}" ${cls ? 'type="text"' : 'type="number" min="0" step="any"'} value="${esc(val(f))}" onchange="App.editarCorte('${k}','${f}',this.value)">` : esc(f === 'observacion' ? val(f) : num(val(f)));
      const det = i.productos_avis.map(p => `${p.nombre} (consumo ${p.consumo}, saldo ${p.saldo}${p.factor !== 1 ? ', ÷' + p.factor : ''})`).join('\n');
      filas += `<tr class="${S.cambiosCorte[k] ? 'modificado' : ''}"><td title="${esc(det)}">${esc(i.producto_planilla)}${i.productos_avis.length ? '' : ' <span class="estado e-gris">sin AVIS</span>'}</td><td>${esc(i.unidad)}</td>
        <td class="num">${inp('consumo')}</td><td class="num">${inp('saldo')}</td><td class="num muted">${num(i.pedido_sugerido)}</td><td class="num">${inp('pedido')}</td>
        <td><span class="punto p-${i.conciliacion.color}" title="${esc(i.conciliacion.texto)}"></span> <span class="pequeno">${i.consumo_app === null ? '' : num(i.consumo_app)}</span></td>
        <td>${esc(i.vencimiento)}</td><td>${inp('observacion', 'obs')}</td></tr>`;
    });
    const archivos = pl => c.archivos && c.archivos[pl] ? `<span class="enlaces"><a href="${c.archivos[pl].sheet_url}" target="_blank">Ver planilla</a><a href="${c.archivos[pl].xlsx_url}" target="_blank">Excel</a><a href="${c.archivos[pl].pdf_url}" target="_blank">PDF</a></span>` : '';
    const env = pl => c.enviado_a && c.enviado_a[pl] ? `<span class="estado e-verde">Enviado ${fecha(c.enviado_a[pl].fecha, true)}</span>` : '';
    V(`<div class="tarjeta"><div class="fila entre"><div><h2 style="margin:0">${esc(c.id)} · ${fecha(c.desde)} al ${fecha(c.hasta)}</h2>
        <span class="muted">Seguridad ${c.seguridad} % · ${esc(c.estado.replace('_', ' '))}${c.conforme_por ? ' · conforme por ' + esc(c.conforme_por) : ''}</span></div>
        <button class="btn sec chico" onclick="App.salirCorte()">← Volver</button></div>
      <div class="fila" style="margin-top:10px">
        ${edit ? `<button class="btn chico" ${nCambios ? '' : 'disabled'} onclick="App.guardarCorte()">Guardar cambios${nCambios ? ' (' + nCambios + ')' : ''}</button>
          <button class="btn ok chico" onclick="App.conformarCorte()">✓ Conforme: generar planillas</button>
          <button class="btn peligro chico" onclick="App.eliminarCorte()">Eliminar borrador</button>`
        : `<button class="btn ok chico" onclick="App.enviarCorteForm()">✉ Enviar por correo</button>${c.estado !== 'ENVIADO_TODO' ? '<button class="btn sec chico" onclick="App.reabrirCorte()">Reabrir para editar</button>' : ''}`}</div>
      ${!edit ? `<p>Farmacia/Droguería: ${archivos('FARMACIA')} ${env('FARMACIA')}<br>Bodega Central: ${archivos('BODEGA')} ${env('BODEGA')}</p>` : ''}</div>
      <div class="chips" style="margin-bottom:8px">
        <button class="chip ${tab === 'FARMACIA' ? 'activo' : ''}" onclick="App.filtrar('corteTab','FARMACIA')">Farmacia / Droguería (${tot('FARMACIA')} con pedido)</button>
        <button class="chip ${tab === 'BODEGA' ? 'activo' : ''}" onclick="App.filtrar('corteTab','BODEGA')">Bodega Central (${tot('BODEGA')} con pedido)</button>
        <button class="chip ${tab === 'OTROS' ? 'activo' : ''}" onclick="App.filtrar('corteTab','OTROS')">Sin planilla (${c.sin_planilla.length})</button>
        <button class="chip ${soloPed ? 'activo' : ''}" onclick="App.filtrar('soloPedido',${!soloPed})">Solo con pedido</button></div>
      ${tab === 'OTROS' ? `<div class="tarjeta"><p class="muted">Productos con consumo en AVIS que no tienen fila en ninguna de las dos planillas. Si corresponde pedirlos, asígneles planilla y fila en Catálogo.</p>
        ${c.sin_planilla.map(x => `<div class="item-sol"><span>${esc(x.nombre)}</span><span>consumo ${num(x.consumo)} · saldo ${num(x.saldo)}</span></div>`).join('') || '<p class="muted">Ninguno.</p>'}</div>` :
      `<div class="leyenda"><span><span class="punto p-verde"></span> AVIS y app coinciden</span><span><span class="punto p-amarillo"></span> diferencia ≤20 %</span><span><span class="punto p-rojo"></span> diferencia >20 %</span><span><span class="punto p-gris"></span> sin datos de la app</span><span>Mantenga el dedo o el mouse sobre el producto para ver los nombres AVIS que suma.</span></div>
      <div class="tabla-wrap"><table><thead><tr><th>Producto (planilla oficial)</th><th>Unidad</th><th class="num">Consumo</th><th class="num">Saldo</th><th class="num">Sugerido</th><th class="num">Pedido</th><th>Entregado app</th><th>Vence</th><th>Observación</th></tr></thead><tbody>${filas}</tbody></table></div>`}`);
  }
  function editarCorte(k, f, v) {
    const ch = S.cambiosCorte[k] = S.cambiosCorte[k] || {};
    ch[f] = v; const [planilla, fila] = k.split('|'); ch.planilla = planilla; ch.fila = Number(fila);
    const b = document.querySelector('[onclick="App.guardarCorte()"]'); if (b) { b.disabled = false; b.textContent = 'Guardar cambios (' + Object.keys(S.cambiosCorte).length + ')'; }
  }
  async function guardarCorte(silencioso) {
    const items = Object.values(S.cambiosCorte); if (!items.length) return true;
    return intentar(async () => { S.corte = await api('guardarCorte', { id: S.corte.id, items }); S.cambiosCorte = {}; if (!silencioso) { toast('Cambios guardados.'); pintarCorte(); } return true; });
  }
  async function conformarCorte() {
    if (!confirm('Se generarán las planillas oficiales (Excel y PDF) con los valores actuales. ¿Continuar?')) return;
    if (!(await guardarCorte(true))) return;
    await intentar(async () => { S.corte = await api('conformarCorte', { id: S.corte.id }); toast('Planillas generadas. Revíselas y luego envíelas.'); pintarCorte(); });
  }
  async function reabrirCorte() { await intentar(async () => { S.corte = await api('guardarCorte', { id: S.corte.id, reabrir: true }); pintarCorte(); }); }
  async function eliminarCorte() { if (!confirm('¿Eliminar este borrador de corte?')) return; await intentar(async () => { await api('eliminarCorte', { id: S.corte.id }); S.corte = null; vCorte(); }); }
  function salirCorte() { if (Object.keys(S.cambiosCorte).length && !confirm('Hay cambios sin guardar. ¿Salir igual?')) return; S.corte = null; S.cambiosCorte = {}; vCorte(); }
  function enviarCorteForm() {
    const c = S.corte;
    modal(`<h2>Enviar planillas por correo</h2>
      <label class="check"><input type="checkbox" id="evF" ${c.enviado_a && c.enviado_a.FARMACIA ? '' : 'checked'}> Planilla Farmacia → ${esc(c.destinatarios.FARMACIA || 'falta correo en Configuración')}</label>
      <label class="check"><input type="checkbox" id="evB" ${c.enviado_a && c.enviado_a.BODEGA ? '' : 'checked'}> Planilla Bodega Central → ${esc(c.destinatarios.BODEGA || 'falta correo en Configuración')}</label>
      <label>Mensaje adicional (opcional)</label><textarea id="evMsg"></textarea>
      <p class="muted pequeno">Se adjuntan Excel y PDF. Van con copia a los correos configurados y a su correo.</p>
      <div class="fila"><button class="btn ok col" onclick="App.enviarCorte()">Enviar</button><button class="btn sec col" onclick="App.cerrarModal()">Cancelar</button></div>`);
  }
  async function enviarCorte() {
    const planillas = []; if ($('#evF').checked) planillas.push('FARMACIA'); if ($('#evB').checked) planillas.push('BODEGA');
    if (!planillas.length) return toast('Seleccione al menos una planilla.', true);
    await intentar(async () => { S.corte = await api('enviarCorte', { id: S.corte.id, planillas, mensaje: $('#evMsg').value }); cerrarModal(); toast('Correo enviado.'); pintarCorte(); });
  }

  /* ================= ADMIN: recepción ================= */
  async function vRecepcion() {
    if (S.recep) return pintarRecepcion();
    V('<div class="vacio"><div class="spinner"></div></div>');
    await intentar(async () => {
      const [recs, cortes] = await Promise.all([api('recepciones', {}, { silencioso: true }), api('cortes', {}, { silencioso: true })]);
      if (S.vista !== 'recepcion') return;
      S.cortesLista = cortes.filter(c => c.estado !== 'BORRADOR');
      V(`<div class="tarjeta"><h2>Nueva recepción</h2>
        <div class="fila"><div class="col"><label>Despacho desde</label><select id="rPl"><option value="FARMACIA">Droguería (planilla Farmacia)</option><option value="BODEGA">Bodega Central Dental</option></select></div>
        <div class="col"><label>Corresponde al pedido (corte)</label><select id="rCo"><option value="">— Sin corte asociado —</option>${S.cortesLista.map(c => `<option value="${c.id}">${c.id} · ${fecha(c.desde)} al ${fecha(c.hasta)}</option>`).join('')}</select></div></div>
        <label>Orden de despacho de AVIS: pegue el texto (recomendado)</label>
        <textarea id="rTxt" placeholder="Abra la orden de despacho en AVIS, presione Ctrl+A y Ctrl+C, y pegue aquí…"></textarea>
        <label>y/o suba la guía o la OD escaneada (PDF o foto) como respaldo</label><input type="file" id="rFile" accept="application/pdf,image/*">
        <p class="muted pequeno">Si solo sube un escaneo, la app intenta leerlo; si no lo logra, queda como respaldo y usted registra lo recibido sobre la lista del pedido.</p>
        <p><button class="btn" onclick="App.leerDespacho()">Leer documento</button></p><div id="odPrev"></div></div>
        <div class="tarjeta"><h2>Recepciones anteriores</h2>${recs.length ? recs.map(r => `<div class="item-sol"><span><b>${esc(r.id)}</b> · ${r.planilla === 'FARMACIA' ? 'Droguería' : 'Bodega Central'}${r.n_od ? ' · OD ' + esc(r.n_od) : ''}<br><span class="muted pequeno">${fecha(r.fecha, true)} · ${esc(r.registrado_por)}</span></span>
          <span><span class="estado ${{ BORRADOR: 'e-amarillo', CERRADA: 'e-azul', ENVIADA: 'e-verde' }[r.estado]}">${esc(r.estado)}</span><br><button class="btn sec chico" style="margin-top:4px" onclick="App.abrirRecepcion('${r.id}')">Abrir</button></span></div>`).join('') : '<p class="muted">Sin recepciones aún.</p>'}</div>`);
    });
  }
  async function leerDespacho() {
    const texto = $('#rTxt').value.trim(), file = $('#rFile').files[0];
    const pl = $('#rPl').value, co = $('#rCo').value;
    if (!texto && !file && !co) return toast('Pegue la orden de despacho, suba un archivo o elija el corte.', true);
    const d = { texto };
    if (file) { if (file.size > 20e6) return toast('El archivo supera 20 MB.', true); d.archivo = { nombre: file.name, mime: file.type, data: file.type.startsWith('image/') && file.size > 3e6 ? await reducirImagenGrande(file) : await leerArchivo(file) }; }
    await intentar(async () => {
      const r = (texto || file) ? await api('leerDespacho', d) : { items: [], n_od: '', n_oa: '', archivo_id: '', origen: 'Manual', aviso: '' };
      S.od = Object.assign(r, { planilla: pl, corte_id: co });
      $('#odPrev').innerHTML = `${r.aviso ? `<p class="estado e-amarillo">${esc(r.aviso)}</p>` : ''}
        <div class="fila"><div class="col"><label>N° OD</label><input id="rOd" value="${esc(r.n_od)}"></div><div class="col"><label>N° OA asociada</label><input id="rOa" value="${esc(r.n_oa)}"></div></div>
        ${r.items.length ? `<p class="muted">${r.items.length} productos leídos${r.items.filter(i => !i.producto_id).length ? ` · <span class="estado e-amarillo">${r.items.filter(i => !i.producto_id).length} no están en el catálogo</span>` : ''}</p>
        <div class="tabla-wrap"><table><thead><tr><th>Código</th><th>Producto</th><th class="num">Solicitado</th><th class="num">Despacho</th><th>Lote</th><th>Vence</th></tr></thead><tbody>
        ${r.items.map(i => `<tr><td>${esc(i.codigo)}</td><td>${esc(i.nombre)}${i.producto_id ? '' : ' <span class="estado e-amarillo">fuera de catálogo</span>'}</td><td class="num">${num(i.solicitado)}</td><td class="num">${num(i.despachado)}</td><td>${esc(i.lotes.join(' / '))}</td><td>${esc(i.vencimientos.join(' / '))}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <p><button class="btn ok" onclick="App.crearRecepcion()">Crear recepción y comparar</button></p>`;
    });
  }
  async function reducirImagenGrande(file) {
    const url = await leerArchivo(file);
    const img = await new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = url; });
    const e = Math.min(1, 2200 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = img.width * e; c.height = img.height * e; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }
  async function crearRecepcion() {
    const o = S.od;
    await intentar(async () => {
      S.recep = await api('crearRecepcion', { planilla: o.planilla, corte_id: o.corte_id, n_od: $('#rOd').value, n_oa: $('#rOa').value, archivo_id: o.archivo_id, origen: o.origen, items_od: o.items });
      S.cambiosRecep = {}; S.od = null; pintarRecepcion();
    });
  }
  async function abrirRecepcion(id) { await intentar(async () => { S.recep = await api('recepcion', { id }); S.cambiosRecep = {}; pintarRecepcion(); }); }
  function pintarRecepcion() {
    const r = S.recep, edit = r.estado === 'BORRADOR', f = S.filtro.recep || 'TODAS';
    const items = r.items.filter(x => f === 'TODAS' || x.evaluacion.color !== 'verde');
    const nC = Object.keys(S.cambiosRecep).length;
    V(`<div class="tarjeta"><div class="fila entre"><div><h2 style="margin:0">${esc(r.id)} · ${r.planilla === 'FARMACIA' ? 'Droguería' : 'Bodega Central'}</h2>
        <span class="muted">${r.n_od ? 'OD ' + esc(r.n_od) : 'Sin OD'}${r.n_oa ? ' · OA ' + esc(r.n_oa) : ''}${r.corte_id ? ' · pedido ' + esc(r.corte_id) : ''} · ${esc(r.estado)}</span></div>
        <button class="btn sec chico" onclick="App.salirRecepcion()">← Volver</button></div>
      <div class="kpis" style="margin-top:10px"><div class="kpi"><b style="color:var(--verde)">${r.resumen.verde}</b><span>conformes</span></div><div class="kpi"><b style="color:var(--amarillo)">${r.resumen.amarillo}</b><span>con observación</span></div><div class="kpi"><b style="color:var(--rojo)">${r.resumen.rojo}</b><span>diferencia crítica</span></div></div>
      ${r.archivo_url ? `<p class="enlaces"><a href="${r.archivo_url}" target="_blank">📎 Ver guía/OD original</a></p>` : ''}
      ${r.archivos && r.archivos.pdf_url ? `<p class="enlaces">Informe: <a href="${r.archivos.sheet_url}" target="_blank">Ver</a><a href="${r.archivos.xlsx_url}" target="_blank">Excel</a><a href="${r.archivos.pdf_url}" target="_blank">PDF</a></p>` : ''}
      <div class="fila">${edit ? `<button class="btn chico" ${nC ? '' : 'disabled'} onclick="App.guardarRecepcion()">Guardar${nC ? ' (' + nC + ')' : ''}</button><button class="btn ok chico" onclick="App.cerrarRecepcion()">✓ Cerrar y generar informe</button>`
        : `<button class="btn ok chico" onclick="App.enviarRecepcionForm()">✉ Enviar informe</button>${r.enviado_a ? '<span class="estado e-verde">Enviado ' + fecha(r.fecha_envio, true) + '</span>' : ''}`}</div>
      ${edit ? '<p class="muted pequeno">“Recibido” viene igual a lo despachado: corríjalo según el conteo físico. Unidades como las registra AVIS.</p>' : ''}
      <label>Observación general</label>${edit ? `<textarea id="rObs" onchange="App.editarRecep('_obs','',this.value)">${esc(r.observacion || '')}</textarea>` : `<p>${esc(r.observacion || '—')}</p>`}</div>
      <div class="chips" style="margin-bottom:8px"><button class="chip ${f === 'TODAS' ? 'activo' : ''}" onclick="App.filtrar('recep','TODAS')">Todas (${r.items.length})</button><button class="chip ${f === 'DIF' ? 'activo' : ''}" onclick="App.filtrar('recep','DIF')">Solo con diferencias (${r.resumen.amarillo + r.resumen.rojo})</button></div>
      <div class="tabla-wrap"><table><thead><tr><th>Producto (AVIS)</th><th class="num">Pedido</th><th class="num">Solicitado OA</th><th class="num">Despachado</th><th class="num">Recibido</th><th>Lote</th><th>Vence</th><th>Evaluación</th><th>Observación</th></tr></thead><tbody>
      ${items.map(x => { const k = (x.fila || '') + '|' + x.nombre_avis, ch = S.cambiosRecep[k] || {};
        const v = fld => ch[fld] !== undefined ? ch[fld] : (x[fld] === null ? '' : x[fld]);
        return `<tr class="${S.cambiosRecep[k] ? 'modificado' : ''}"><td>${esc(x.nombre_avis || x.producto_planilla)}${x.codigo_avis ? '<br><span class="muted pequeno">' + esc(x.codigo_avis) + '</span>' : ''}</td>
        <td class="num">${num(x.pedido)}</td><td class="num">${num(x.solicitado)}</td><td class="num">${num(x.despachado)}</td>
        <td class="num">${edit ? `<input class="num" type="number" min="0" step="any" value="${esc(v('recibido'))}" onchange="App.editarRecep('${esc(k)}','recibido',this.value)">` : num(x.recibido)}</td>
        <td class="pequeno">${esc(x.lote)}</td><td class="pequeno">${esc(x.vencimiento)}</td><td><span class="estado e-${x.evaluacion.color}">${esc(x.evaluacion.texto)}</span></td>
        <td>${edit ? `<input type="text" value="${esc(v('observacion'))}" onchange="App.editarRecep('${esc(k)}','observacion',this.value)">` : esc(x.observacion || '')}</td></tr>`; }).join('')}</tbody></table></div>`);
  }
  function editarRecep(k, f, v) {
    if (k === '_obs') { S.recepObs = v; S.cambiosRecep._obs = true; }
    else { const x = S.recep.items.find(i => ((i.fila || '') + '|' + i.nombre_avis) === k); const ch = S.cambiosRecep[k] = S.cambiosRecep[k] || { fila: x.fila, nombre_avis: x.nombre_avis }; ch[f] = v; }
    const b = document.querySelector('[onclick="App.guardarRecepcion()"]'); if (b) { b.disabled = false; b.textContent = 'Guardar (' + Object.keys(S.cambiosRecep).length + ')'; }
  }
  async function guardarRecepcion(silencioso) {
    const items = Object.keys(S.cambiosRecep).filter(k => k !== '_obs').map(k => S.cambiosRecep[k]);
    const d = { id: S.recep.id, items }; if (S.cambiosRecep._obs) d.observacion = S.recepObs;
    if (!items.length && !S.cambiosRecep._obs) return true;
    return intentar(async () => { S.recep = await api('guardarRecepcion', d); S.cambiosRecep = {}; if (!silencioso) { toast('Guardado.'); pintarRecepcion(); } return true; });
  }
  async function cerrarRecepcion() {
    if (!confirm('Se cerrará la recepción y se generará el informe de comparación. ¿Continuar?')) return;
    if (!(await guardarRecepcion(true))) return;
    await intentar(async () => { S.recep = await api('cerrarRecepcion', { id: S.recep.id }); toast('Informe generado.'); pintarRecepcion(); });
  }
  function salirRecepcion() { if (Object.keys(S.cambiosRecep).length && !confirm('Hay cambios sin guardar. ¿Salir igual?')) return; S.recep = null; S.cambiosRecep = {}; vRecepcion(); }
  function enviarRecepcionForm() {
    const r = S.recep;
    modal(`<h2>Enviar informe de recepción</h2><p>Para: <b>${esc(r.destinatario || 'falta correo en Configuración')}</b></p>
      ${r.archivo_url ? '<label class="check"><input type="checkbox" id="erG" checked> Adjuntar la guía/OD original</label>' : ''}
      <label>Mensaje adicional (opcional)</label><textarea id="erMsg" placeholder="Ej: solicito reponer los eyectores faltantes"></textarea>
      <div class="fila"><button class="btn ok col" onclick="App.enviarRecepcion()">Enviar</button><button class="btn sec col" onclick="App.cerrarModal()">Cancelar</button></div>`);
  }
  async function enviarRecepcion() {
    await intentar(async () => { S.recep = await api('enviarRecepcion', { id: S.recep.id, mensaje: $('#erMsg').value, adjuntar_guia: $('#erG') ? $('#erG').checked : false }); cerrarModal(); toast('Informe enviado.'); pintarRecepcion(); });
  }

  /* ================= ADMIN: catálogo ================= */
  async function vCatAdmin(forzar) {
    if (!S.admin || forzar) {
      V('<div class="vacio"><div class="spinner"></div></div>');
      const ok = await intentar(async () => { S.admin = await api('catalogoAdmin', {}, { silencioso: true }); return true; });
      if (!ok || S.vista !== 'catadmin') return;
    }
    const f = S.filtro.cat || 'VISIBLES';
    V(`<div class="buscador"><div class="fila"><input class="col" type="search" id="qa" placeholder="Buscar por nombre AVIS o código…" value="${esc(S.filtro.qa || '')}" oninput="App.buscarAdmin(this.value)">
      <button class="btn chico" onclick="App.editarProducto('')">+ Nuevo</button><button class="btn sec chico" onclick="App.importarFotosForm()">⬆ Importar fotos desde planilla</button></div>
      <div class="chips" style="margin-top:8px">${[['VISIBLES', 'Visibles para TONS'], ['OCULTOS', 'Ocultos'], ['SINFOTO', 'Visibles sin foto'], ['FARMACIA', 'Planilla Farmacia'], ['BODEGA', 'Planilla Bodega'], ['NINGUNA', 'Sin planilla'], ['REVISAR', 'Revisar'], ['TODOS', 'Todos']].map(x =>
        `<button class="chip ${f === x[0] ? 'activo' : ''}" onclick="App.filtrar('cat','${x[0]}')">${x[1]}</button>`).join('')}</div></div><div id="listaAdmin"></div>`);
    pintarCatAdmin();
  }
  function pintarCatAdmin() {
    const f = S.filtro.cat || 'VISIBLES', q = normal(S.filtro.qa || '').split(/\s+/).filter(Boolean);
    const l = S.admin.productos.filter(p => {
      if (f === 'VISIBLES' && !p.visible) return false; if (f === 'OCULTOS' && p.visible) return false; if (f === 'SINFOTO' && (!p.visible || p.tiene_foto)) return false;
      if (['FARMACIA', 'BODEGA', 'NINGUNA'].includes(f) && p.planilla !== f) return false;
      if (f === 'REVISAR' && !(p.certeza && p.certeza !== 'ALTA') && !/revisar/i.test(p.nota)) return false;
      const t = normal(p.nombre_avis + ' ' + p.codigo_avis); return q.every(w => t.includes(w));
    });
    $('#listaAdmin').innerHTML = `<p class="muted pequeno">${l.length} productos</p>` + l.slice(0, 300).map(p => `<div class="producto" onclick="App.editarProducto('${p.id}')" style="cursor:pointer">
      <div class="nom">${esc(p.nombre_avis)}<small>${p.codigo_avis ? 'Cód. ' + esc(p.codigo_avis) + ' · ' : ''}${p.planilla === 'NINGUNA' ? 'Sin planilla' : esc(p.planilla) + ' fila ' + p.fila + (p.factor !== 1 ? ' · ÷' + p.factor : '') + (p.rol_mapeo === 'ALTERNATIVO' ? ' · alternativo' : '')}
      ${p.certeza && p.certeza !== 'ALTA' ? ` · <span class="estado e-amarillo">${esc(p.certeza)}</span>` : ''}</small></div>
      <span>${p.visible ? '<span class="estado e-verde">visible</span>' : '<span class="estado e-gris">oculto</span>'}</span>
      <label class="foto-btn" title="${p.tiene_foto ? 'Cambiar foto con la cámara' : 'Agregar foto con la cámara'}" onclick="event.stopPropagation()" style="display:grid;place-items:center;${p.tiene_foto ? '' : 'opacity:.55'}">📷<input type="file" accept="image/*" capture="environment" style="display:none" onchange="App.subirFoto('${p.id}',this.files[0],true)"></label></div>`).join('');
  }
  function editarProducto(id) {
    const p = id ? S.admin.productos.find(x => x.id === id) : { id: '', nombre_avis: '', codigo_avis: '', categoria: 'Insumos generales', planilla: 'NINGUNA', fila: '', factor: 1, rol_mapeo: 'PRINCIPAL', visible: true, nota: '' };
    const cats = [...new Set(S.admin.productos.map(x => x.categoria))].sort();
    modal(`<h2>${id ? 'Editar producto' : 'Nuevo producto'}</h2>
      <label>Nombre exactamente como en AVIS</label><input id="pN" value="${esc(p.nombre_avis)}">
      <p class="muted pequeno">Debe ser idéntico al de AVIS para que calcen inventario, cortes y despachos.</p>
      <div class="fila"><div class="col"><label>Código AVIS</label><input id="pC" value="${esc(p.codigo_avis)}"></div><div class="col"><label>Categoría</label><input id="pCat" list="lcats" value="${esc(p.categoria)}"><datalist id="lcats">${cats.map(c => `<option>${esc(c)}</option>`).join('')}</datalist></div></div>
      <div class="fila"><div class="col"><label>Planilla de pedido</label><select id="pPl" onchange="App.filasPlanilla()"><option value="NINGUNA">Ninguna</option><option value="FARMACIA">Farmacia / Droguería</option><option value="BODEGA">Bodega Central</option></select></div>
        <div class="col"><label>Rol en la fila</label><select id="pRol"><option value="PRINCIPAL">Principal</option><option value="ALTERNATIVO">Alternativo (también suma)</option></select></div></div>
      <label>Fila de la planilla</label><select id="pFi"></select>
      <label>Factor de conversión (unidades AVIS por unidad de la planilla)</label><input id="pFa" type="number" min="0.0001" step="any" value="${p.factor}">
      <p class="muted pequeno">Ej.: guantes 100 (AVIS cuenta guantes y la planilla pide cajas de 100); anestesia 50; tórulas de algodón 500.</p>
      <label class="check"><input type="checkbox" id="pVi" ${p.visible ? 'checked' : ''}> Visible para las TONS en la app</label>
      <label>Nota</label><input id="pNo" value="${esc(p.nota)}">
      ${id ? `<h3>Foto</h3><div id="pFoto" class="muted">${p.tiene_foto ? 'Cargando foto…' : 'Sin foto.'}</div>
        <div class="fila" style="margin-top:8px"><label class="btn sec chico" style="margin:0">📷 Tomar foto<input type="file" accept="image/*" capture="environment" style="display:none" onchange="App.subirFoto('${p.id}',this.files[0])"></label>
        <label class="btn sec chico" style="margin:0">🖼 Elegir de galería<input type="file" accept="image/*" style="display:none" onchange="App.subirFoto('${p.id}',this.files[0])"></label>
        ${p.tiene_foto ? `<button class="btn peligro chico" onclick="App.quitarFoto('${p.id}')">Quitar foto</button>` : ''}</div>` : ''}
      <div class="fila" style="margin-top:14px"><button class="btn ok col" onclick="App.guardarProducto('${p.id}')">Guardar</button><button class="btn sec col" onclick="App.cerrarModal()">Cancelar</button></div>`);
    $('#pPl').value = p.planilla; $('#pRol').value = p.rol_mapeo || 'PRINCIPAL'; filasPlanilla(p.fila);
    if (id && p.tiene_foto) api('foto', { producto_id: id }, { silencioso: true }).then(r => { const el = $('#pFoto'); if (el && r.data) el.innerHTML = `<img class="foto" src="${r.data}" alt="">`; }).catch(() => {});
  }
  function filasPlanilla(sel) {
    const pl = $('#pPl').value, s = $('#pFi');
    const l = S.admin.filas.filter(f => f.planilla === pl);
    s.innerHTML = pl === 'NINGUNA' ? '<option value="">—</option>' : l.map(f => `<option value="${f.fila}">Fila ${f.fila} · ${esc(f.seccion ? f.seccion + ' · ' : '')}${esc(f.producto_planilla)} (${esc(f.unidad_planilla)})</option>`).join('');
    if (sel) s.value = sel;
  }
  async function guardarProducto(id) {
    const d = { id, nombre_avis: $('#pN').value, codigo_avis: $('#pC').value, categoria: $('#pCat').value, planilla: $('#pPl').value, fila: $('#pFi').value,
      rol_mapeo: $('#pRol').value, factor: $('#pFa').value, visible: $('#pVi').checked, nota: $('#pNo').value };
    await intentar(async () => { await api('guardarProducto', d); cerrarModal(); toast('Producto guardado.'); S.catTs = 0; vCatAdmin(true); });
  }
  async function subirFoto(id, file, desdeLista) {
    if (!file) return;
    await intentar(async () => {
      const data = await reducirImagen(file);
      await api('subirFoto', { producto_id: id, data });
      S.fotos[id] = data; LS.set('foto_' + id, data); S.catTs = 0;
      const p = S.admin.productos.find(x => x.id === id); if (p) p.tiene_foto = true;
      toast('Foto guardada.'); if (desdeLista) pintarCatAdmin(); else editarProducto(id);
    });
  }

  /* ---- Importar fotos desde las planillas Excel con imágenes ---- */
  const HOJA_PLANILLA = { 'ABASTECIMIENTO': 'FARMACIA', 'PASTA, CEPILLO Y DEDAL': 'BODEGA' };
  function cargarJSZip() {
    if (window.JSZip) return Promise.resolve();
    return new Promise((ok, mal) => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      sc.onload = ok; sc.onerror = () => mal(new Error('No se pudo cargar el lector de Excel. Revise su conexión.')); document.head.appendChild(sc); });
  }
  async function imagenesDeXlsx(file) {
    const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const zip = await JSZip.loadAsync(file);
    const texto = p => zip.file(p) ? zip.file(p).async('string').then(t => t.replace(/^\uFEFF/, '').trim()) : Promise.resolve(null);
    const xml = s => new DOMParser().parseFromString(s, 'application/xml');
    const ruta = (dir, t) => { if (t.startsWith('/')) return t.slice(1); const partes = (dir + '/' + t).split('/'), out = [];
      partes.forEach(x => { if (x === '..') out.pop(); else if (x && x !== '.') out.push(x); }); return out.join('/'); };
    const rels = async p => { const dir = p.slice(0, p.lastIndexOf('/')), s_ = await texto(dir + '/_rels/' + p.slice(p.lastIndexOf('/') + 1) + '.rels'), m = {};
      if (s_) [...xml(s_).getElementsByTagNameNS('*', 'Relationship')].forEach(r => m[r.getAttribute('Id')] = ruta(dir, r.getAttribute('Target'))); return m; };
    const wbTxt = await texto('xl/workbook.xml'); if (!wbTxt) throw new Error(file.name + ' no es un archivo Excel válido.');
    const wbRels = await rels('xl/workbook.xml'), res = [];
    for (const sh of [...xml(wbTxt).getElementsByTagNameNS('*', 'sheet')]) {
      const planilla = HOJA_PLANILLA[(sh.getAttribute('name') || '').trim()]; if (!planilla) continue;
      const sp = wbRels[sh.getAttributeNS(NS_R, 'id') || sh.getAttribute('r:id')]; if (!sp) continue;
      const dp = Object.values(await rels(sp)).find(t => /drawings\/[^/]+\.xml$/.test(t)); if (!dp) continue;
      const dRels = await rels(dp), dXml = xml(await texto(dp));
      for (const anc of [...dXml.documentElement.children]) {
        const from = [...anc.children].find(c => c.localName === 'from'); if (!from) continue;
        const fila = Number([...from.children].find(c => c.localName === 'row').textContent) + 1;
        const blip = anc.getElementsByTagNameNS('*', 'blip')[0]; if (!blip) continue;
        const media = dRels[blip.getAttributeNS(NS_R, 'embed') || blip.getAttribute('r:embed')]; if (!media || !zip.file(media)) continue;
        res.push({ planilla, fila, media, archivo: file.name, blob: await zip.file(media).async('blob') });
      }
    }
    return res;
  }
  function importarFotosForm() {
    modal(`<h2>Importar fotos desde planilla</h2>
      <p class="muted">Seleccione las planillas oficiales con imágenes (Farmacia y/o Bodega Central). Cada imagen se asigna a los productos AVIS de su fila.</p>
      <input type="file" id="ifArch" accept=".xlsx" multiple>
      <label class="check"><input type="checkbox" id="ifReemp"> Reemplazar también las fotos que ya existen</label>
      <div id="ifRes"></div>
      <div class="fila" style="margin-top:10px"><button class="btn col" id="ifLeer" onclick="App.leerFotosPlanilla()">Leer planillas</button><button class="btn sec col" onclick="App.cerrarModal()">Cerrar</button></div>`);
  }
  async function leerFotosPlanilla() {
    const archivos = [...$('#ifArch').files]; if (!archivos.length) return toast('Seleccione al menos una planilla.', true);
    const reemp = $('#ifReemp').checked, out = $('#ifRes');
    out.innerHTML = '<p class="muted">Leyendo planillas…</p>';
    await intentar(async () => {
      await cargarJSZip();
      let imgs = [];
      for (const f of archivos) imgs = imgs.concat(await imagenesDeXlsx(f));
      if (!imgs.length) { out.innerHTML = '<p class="estado e-amarillo">No se encontraron imágenes en las hojas ABASTECIMIENTO o "PASTA, CEPILLO Y DEDAL".</p>'; return; }
      const porFila = {}; S.admin.productos.forEach(p => { if (p.planilla !== 'NINGUNA') (porFila[p.planilla + '|' + p.fila] = porFila[p.planilla + '|' + p.fila] || []).push(p); });
      const tareas = [], sinProd = [], conFoto = [];
      imgs.forEach(im => {
        const ps = porFila[im.planilla + '|' + im.fila];
        if (!ps) { const f = S.admin.filas.find(x => x.planilla === im.planilla && x.fila === im.fila); if (f) sinProd.push(f.producto_planilla); return; }
        ps.forEach(p => { if (p.tiene_foto && !reemp) conFoto.push(p.nombre_avis); else tareas.push({ p, im }); });
      });
      S.importFotos = tareas;
      const pl = [...new Set(imgs.map(i => i.planilla))].map(x => x === 'FARMACIA' ? 'Farmacia' : 'Bodega Central').join(' y ');
      out.innerHTML = `<div class="kpis" style="margin-top:10px"><div class="kpi"><b>${imgs.length}</b><span>imágenes en ${pl}</span></div><div class="kpi"><b>${tareas.length}</b><span>productos AVIS recibirán foto</span></div><div class="kpi"><b>${conFoto.length}</b><span>ya tienen foto (se mantienen)</span></div></div>
        ${sinProd.length ? `<p class="muted pequeno">Filas con imagen sin producto AVIS asociado (se omiten): ${sinProd.map(esc).join(' · ')}</p>` : ''}
        ${tareas.length ? `<p><button class="btn ok bloque" onclick="App.cargarFotosPlanilla()">Cargar ${tareas.length} fotos</button></p><div id="ifProg"></div>` : ''}`;
    });
  }
  async function cargarFotosPlanilla() {
    const tareas = S.importFotos || [], prog = $('#ifProg'), btn = document.querySelector('[onclick="App.cargarFotosPlanilla()"]');
    if (btn) btn.disabled = true;
    const cache = {}, errores = []; let hechos = 0;
    const paso = t => { if (prog) prog.innerHTML = `<p>${t}</p><div style="height:8px;background:var(--azul-claro);border-radius:6px"><div style="height:8px;width:${Math.round(hechos * 100 / tareas.length)}%;background:var(--verde);border-radius:6px"></div></div>`; };
    for (let i = 0; i < tareas.length; i += 10) {
      const lote = [];
      for (const t of tareas.slice(i, i + 10)) {
        const k = t.im.archivo + '|' + t.im.media;
        try { if (!cache[k]) cache[k] = await reducirImagen(t.im.blob); lote.push({ producto_id: t.p.id, data: cache[k] }); }
        catch (e) { errores.push(t.p.nombre_avis + ': formato de imagen no compatible'); }
      }
      paso(`Subiendo fotos… ${hechos} de ${tareas.length}`);
      if (lote.length) {
        try { const r = await api('subirFotosLote', { fotos: lote }, { silencioso: true }); errores.push(...r.errores);
          lote.forEach(x => { const p = S.admin.productos.find(y => y.id === x.producto_id); if (p) p.tiene_foto = true; LS.set('foto_' + x.producto_id, x.data); S.fotos[x.producto_id] = x.data; }); }
        catch (e) { if (e.message === '_sesion') return; errores.push('Lote ' + (i / 10 + 1) + ': ' + e.message); }
      }
      hechos = Math.min(tareas.length, i + 10);
    }
    paso(`Listo: ${hechos - errores.length} fotos cargadas.`);
    if (errores.length && prog) prog.insertAdjacentHTML('beforeend', `<p class="estado e-amarillo">${errores.length} con problema</p><p class="muted pequeno">${errores.map(esc).join('<br>')}</p>`);
    S.catTs = 0; S.importFotos = null; pintarCatAdmin();
  }
  async function quitarFoto(id) { await intentar(async () => { await api('quitarFoto', { producto_id: id }); LS.del('foto_' + id); delete S.fotos[id]; const p = S.admin.productos.find(x => x.id === id); if (p) p.tiene_foto = false; S.catTs = 0; editarProducto(id); }); }

  /* ================= ADMIN: usuarios ================= */
  const VIG = { INDEFINIDO: ['e-verde', 'Indefinido'], VIGENTE: ['e-verde', 'Vigente'], POR_VENCER: ['e-amarillo', 'Por vencer'], VENCIDO: ['e-rojo', 'Vencido'], INACTIVO: ['e-gris', 'Inactivo'] };
  async function vUsuarios() {
    V('<div class="vacio"><div class="spinner"></div></div>');
    await intentar(async () => {
      const ru = await api('usuarios', {}, { silencioso: true }); S.usuarios = ru.usuarios; S.permisosNombres = ru.permisos;
      if (S.vista !== 'usuarios') return; pintarUsuarios();
    });
  }
  function pintarUsuarios() {
    const f = S.filtro.usu || 'TODOS';
    const l = S.usuarios.filter(u => f === 'TODOS' || u.vigencia === f || (f === 'VIGENTE' && u.vigencia === 'INDEFINIDO'));
    const cnt = k => S.usuarios.filter(u => u.vigencia === k).length;
    V(`<div class="fila entre" style="margin-bottom:8px"><div class="chips">${[['TODOS', 'Todos (' + S.usuarios.length + ')'], ['VIGENTE', 'Vigentes'], ['POR_VENCER', 'Por vencer (' + cnt('POR_VENCER') + ')'], ['VENCIDO', 'Vencidos (' + cnt('VENCIDO') + ')'], ['INACTIVO', 'Inactivos']].map(x =>
      `<button class="chip ${f === x[0] ? 'activo' : ''}" onclick="App.filtrar('usu','${x[0]}')">${x[1]}</button>`).join('')}</div><button class="btn chico" onclick="App.editarUsuario('')">+ Nuevo usuario</button></div>
      ${l.map(u => `<div class="tarjeta" onclick="App.editarUsuario('${u.id}')" style="cursor:pointer"><div class="fila entre"><b>${esc(u.nombre)}</b><span class="estado ${VIG[u.vigencia][0]}">${VIG[u.vigencia][1]}</span></div>
        <div class="muted">${esc(u.usuario)} · <b>${ROL_NOMBRE[u.rol] || u.rol}</b>${u.cargo ? ' · ' + esc(u.cargo) : ''} · ${esc(u.tipo_contrato)}${u.fecha_termino ? ' hasta ' + fecha(u.fecha_termino) + (u.dias_vigencia !== null && u.dias_vigencia >= 0 ? ' (' + u.dias_vigencia + ' días)' : '') : ''}</div>
        ${u.rol === 'BODEGA' ? `<div class="pequeno" style="margin-top:4px">${u.permisos.length ? u.permisos.map(p => `<span class="estado e-azul" style="margin:2px 4px 0 0">${esc((S.permisosNombres || {})[p] || p)}</span>`).join('') : '<span class="estado e-gris">Sin permisos activos</span>'}</div>` : ''}
        <div class="muted pequeno">Último ingreso: ${u.ultimo_acceso ? fecha(u.ultimo_acceso, true) : 'nunca'}</div></div>`).join('') || '<div class="vacio">Sin usuarios en esta vista.</div>'}`);
  }
  function editarUsuario(id) {
    const u = id ? S.usuarios.find(x => x.id === id) : { id: '', usuario: '', nombre: '', rut: '', cargo: 'TONS', rol: 'USUARIO', correo: '', tipo_contrato: 'Plazo fijo', fecha_inicio: hoyISO(), fecha_termino: new Date().getFullYear() + '-12-31', activo: 'SI' };
    modal(`<h2>${id ? 'Editar usuario' : 'Nuevo usuario'}</h2>
      <label>Nombre completo</label><input id="uN" value="${esc(u.nombre)}">
      <div class="fila"><div class="col"><label>Usuario (para ingresar)</label><input id="uU" value="${esc(u.usuario)}" autocapitalize="none" placeholder="ej: carmijo"></div><div class="col"><label>RUT</label><input id="uR" value="${esc(u.rut)}"></div></div>
      <div class="fila"><div class="col"><label>Cargo</label><input id="uC" value="${esc(u.cargo)}" list="lcargos"><datalist id="lcargos"><option>TONS</option><option>Odontólogo/a</option><option>Encargada de bodega</option><option>Encargado de programa</option></datalist></div>
        <div class="col"><label>Perfil</label><select id="uRol" onchange="App.tipoContrato()"><option value="USUARIO">Usuario (solicita insumos)</option><option value="BODEGA">Encargada de bodega</option>${u.id && u.id === S.usuario.id ? '<option value="ADMIN">Administrador</option>' : ''}</select></div></div>
      <div id="uPermBox" class="tarjeta" style="background:var(--azul-claro);box-shadow:none;margin-top:10px"><b>Permisos de la encargada de bodega</b>
        ${Object.entries(S.permisosNombres || {}).map(([k, v]) => `<label class="check"><input type="checkbox" class="uPerm" value="${k}" ${(u.permisos || []).includes(k) && u.rol === 'BODEGA' ? 'checked' : ''}> ${esc(v)}</label>`).join('')}</div>
      <label>Correo (opcional)</label><input id="uE" type="email" value="${esc(u.correo)}">
      <div class="fila"><div class="col"><label>Tipo de contrato</label><select id="uT" onchange="App.tipoContrato()"><option>Indefinido</option><option>Plazo fijo</option><option>Reemplazo</option><option>Suplencia</option><option>Honorario</option></select></div>
        <div class="col"><label>Inicio</label><input id="uI" type="date" value="${esc(u.fecha_inicio)}"></div><div class="col" id="uFinBox"><label>Término de vigencia</label><input id="uF" type="date" value="${esc(u.fecha_termino)}"></div></div>
      <p class="muted pequeno">Al llegar la fecha de término, el acceso se bloquea automáticamente. Los administradores reciben aviso por correo antes del vencimiento.</p>
      <label class="check"><input type="checkbox" id="uA" ${u.activo === 'SI' ? 'checked' : ''}> Usuario activo</label>
      <div class="fila" style="margin-top:10px"><button class="btn ok col" onclick="App.guardarUsuario('${u.id}')">Guardar</button>${id ? `<button class="btn sec col" onclick="App.resetClave('${u.id}')">Restablecer clave</button>` : ''}</div>
      <p><button class="btn sec bloque" onclick="App.cerrarModal()">Cancelar</button></p>`);
    $('#uRol').value = u.rol; $('#uT').value = u.tipo_contrato || 'Indefinido'; tipoContrato();
  }
  function tipoContrato() { $('#uFinBox').style.display = $('#uT').value === 'Indefinido' ? 'none' : ''; const pb = $('#uPermBox'); if (pb) pb.style.display = $('#uRol').value === 'BODEGA' ? '' : 'none'; }
  async function guardarUsuario(id) {
    const d = { id, nombre: $('#uN').value, usuario: $('#uU').value, rut: $('#uR').value, cargo: $('#uC').value, rol: $('#uRol').value, correo: $('#uE').value,
      tipo_contrato: $('#uT').value, fecha_inicio: $('#uI').value, fecha_termino: $('#uF').value, activo: $('#uA').checked ? 'SI' : 'NO',
      permisos: [...document.querySelectorAll('.uPerm:checked')].map(x => x.value) };
    await intentar(async () => {
      const r = await api('guardarUsuario', d);
      if (r.clave_temporal) modal(claveTemporalHtml(d.nombre, d.usuario, r.clave_temporal)); else { cerrarModal(); toast('Usuario guardado.'); }
      vUsuarios();
    });
  }
  function claveTemporalHtml(nombre, usuario, clave) {
    return `<h2>Acceso creado</h2><p>Entregue estos datos a <b>${esc(nombre)}</b>. Al ingresar se le pedirá crear su propia clave.</p>
      <div class="tarjeta" style="background:var(--azul-claro)"><p>Usuario: <b>${esc(usuario)}</b><br>Clave temporal: <b style="font-size:20px;letter-spacing:.05em">${esc(clave)}</b></p></div>
      <p><button class="btn bloque" onclick="App.cerrarModal()">Listo</button></p>`;
  }
  async function resetClave(id) {
    const u = S.usuarios.find(x => x.id === id);
    if (!confirm('¿Generar una clave temporal nueva para ' + u.nombre + '?')) return;
    await intentar(async () => { const r = await api('resetClave', { id }); modal(claveTemporalHtml(u.nombre, u.usuario, r.clave_temporal)); });
  }

  /* ================= ADMIN: configuración y menú ================= */
  function vMas() {
    const c = (v, t, d) => `<div class="tarjeta" style="cursor:pointer" onclick="App.ir('${v}')"><h2>${t}</h2><p class="muted">${d}</p></div>`;
    const enNav = navItems().map(n => n[0]);
    V([puede('PEDIR') && !enNav.includes('catalogo') ? c('catalogo', '🦷 Solicitar insumos', 'Pedir a bodega dental como cualquier funcionario.') : '',
      puede('PEDIR') ? c('mis', '📋 Mis pedidos', 'Estado de mis solicitudes.') : '',
      puede('PLAZOS') ? c('plazos', '⏰ Plazos de pedido', 'Fechas y horas límite para que las TONS soliciten.') : '',
      puede('REPORTES') ? c('reportes', '📈 Consumo y cumplimiento', 'Quién pide en plazo, qué se consume y por box.') : '',
      esAdmin() ? c('usuarios', '👥 Usuarios y permisos', 'Accesos, vigencia de contratos, permisos de la encargada de bodega.') : '',
      esAdmin() ? c('config', '⚙️ Configuración', 'Correos de Droguería y Bodega Central, % de seguridad, modo de plazos.') : '',
      c('perfil', '👤 Mi perfil', 'Cambiar clave, instalar la app, cerrar sesión.')].join(''));
  }

  /* ================= Plazos de pedido ================= */
  const dtLocal = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  async function vPlazos() {
    V('<div class="vacio"><div class="spinner"></div></div>');
    await intentar(async () => { S.plazos = await api('plazos', {}, { silencioso: true }); if (S.vista === 'plazos') pintarPlazos(); });
  }
  function pintarPlazos() {
    const d = S.plazos, hoy = new Date();
    const lun = new Date(hoy); lun.setDate(hoy.getDate() + ((8 - hoy.getDay()) % 7 || 7)); lun.setHours(8, 0, 0, 0);
    const mar = new Date(lun); mar.setDate(lun.getDate() + 1); mar.setHours(12, 0, 0, 0);
    const COL = { ABIERTO: 'e-verde', PROXIMO: 'e-azul', CERRADO: 'e-gris', INACTIVO: 'e-gris' };
    V(`<div class="tarjeta"><h2>Nuevo plazo de pedido</h2>
      <p class="muted">Las solicitudes hechas entre la apertura y la fecha/hora límite quedan <b>en plazo</b>; las demás, <b>fuera de plazo</b>. Modo actual: <b>${d.modo === 'BLOQUEAR' ? 'bloquear (solo urgentes con motivo)' : 'marcar (se aceptan y quedan registradas)'}</b>${esAdmin() ? ' — se cambia en Configuración' : ''}.</p>
      <label>Nombre</label><input id="plN" placeholder="Ej: Pedido semanal">
      <div class="fila"><div class="col"><label>Apertura (fecha y hora)</label><input type="datetime-local" id="plA" value="${dtLocal(lun)}"></div>
      <div class="col"><label>Fecha y hora límite</label><input type="datetime-local" id="plC" value="${dtLocal(mar)}"></div></div>
      <label>Repetir las semanas siguientes (misma hora)</label><input type="number" id="plR" min="0" max="26" value="0">
      <p class="muted pequeno">Ej.: apertura lunes 08:00, límite martes 12:00 y repetir 7 → quedan programados los próximos 2 meses.</p>
      <p><button class="btn" onclick="App.guardarPlazo()">Crear plazo</button></p></div>
      <div class="tarjeta"><h2>Plazos</h2>${d.plazos.length ? d.plazos.map(p => `<div class="item-sol"><span><b>${esc(p.nombre)}</b> <span class="estado ${COL[p.estado]}">${p.estado === 'PROXIMO' ? 'Próximo' : p.estado.charAt(0) + p.estado.slice(1).toLowerCase()}</span><br>
        <span class="muted pequeno">${dia(p.apertura)}${fecha(p.apertura, true)} → ${dia(p.cierre)}${fecha(p.cierre, true)} · ${p.solicitudes} solicitud${p.solicitudes === 1 ? '' : 'es'}${p.personas.length ? ' (' + p.personas.map(esc).join(', ') + ')' : ''}</span></span>
        <span>${p.estado !== 'CERRADO' && p.activo ? `<button class="btn sec chico" onclick="App.editarPlazo('${p.id}')">Editar</button> ` : ''}${p.activo ? `<button class="btn peligro chico" onclick="App.eliminarPlazo('${p.id}')">Quitar</button>` : ''}</span></div>`).join('') : '<p class="muted">Aún no hay plazos: mientras no existan, las solicitudes no se controlan.</p>'}</div>`);
  }
  async function guardarPlazo(id) {
    const d = id ? { id, nombre: $('#epN').value, apertura: $('#epA').value, cierre: $('#epC').value } : { nombre: $('#plN').value, apertura: $('#plA').value, cierre: $('#plC').value, repetir_semanas: $('#plR').value };
    await intentar(async () => { S.plazos = await api('guardarPlazo', d); cerrarModal(); toast('Plazo guardado.'); S.inicio = null; cargarInicio(); pintarPlazos(); });
  }
  function editarPlazo(id) {
    const p = S.plazos.plazos.find(x => x.id === id);
    modal(`<h2>Editar plazo</h2><label>Nombre</label><input id="epN" value="${esc(p.nombre)}">
      <label>Apertura</label><input type="datetime-local" id="epA" value="${p.apertura.slice(0, 16)}"><label>Fecha y hora límite</label><input type="datetime-local" id="epC" value="${p.cierre.slice(0, 16)}">
      <div class="fila" style="margin-top:12px"><button class="btn ok col" onclick="App.guardarPlazo('${id}')">Guardar</button><button class="btn sec col" onclick="App.cerrarModal()">Cancelar</button></div>`);
  }
  async function eliminarPlazo(id) { if (!confirm('¿Quitar este plazo? Si ya tiene solicitudes, se conserva en el historial como inactivo.')) return; await intentar(async () => { S.plazos = await api('eliminarPlazo', { id }); pintarPlazos(); }); }

  /* ================= Reporte de consumo y cumplimiento ================= */
  async function vReportes() {
    const h = new Date(), dsd = new Date(h.getTime() - 29 * 864e5), f = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    V(`<div class="tarjeta"><div class="fila"><div class="col"><label>Desde</label><input type="date" id="rpD" value="${S.rpD || f(dsd)}"></div><div class="col"><label>Hasta</label><input type="date" id="rpH" value="${S.rpH || f(h)}"></div>
      <div style="align-self:flex-end"><button class="btn" onclick="App.generarReporte()">Ver reporte</button></div></div></div><div id="rpOut"></div>`);
    generarReporte();
  }
  async function generarReporte() {
    S.rpD = $('#rpD').value; S.rpH = $('#rpH').value;
    $('#rpOut').innerHTML = '<div class="vacio"><div class="spinner"></div></div>';
    await intentar(async () => {
      const r = S.reporte = await api('reporte', { desde: S.rpD, hasta: S.rpH }, { silencioso: true });
      const sem = p => p === null ? '<span class="estado e-gris">sin plazos</span>' : `<span class="estado ${p >= 90 ? 'e-verde' : p >= 70 ? 'e-amarillo' : 'e-rojo'}">${p} %</span>`;
      const t = r.totales, maxE = Math.max(1, ...r.productos.map(x => x.entregado));
      $('#rpOut').innerHTML = `<div class="kpis"><div class="kpi"><b>${t.solicitudes}</b><span>solicitudes</span></div><div class="kpi"><b>${t.pct_en_plazo === null ? '—' : t.pct_en_plazo + ' %'}</b><span>en plazo</span></div>
        <div class="kpi"><b>${t.fuera_plazo}</b><span>fuera de plazo</span></div><div class="kpi"><b>${t.urgentes}</b><span>urgentes</span></div><div class="kpi"><b>${num(t.unidades_entregadas)}</b><span>unidades entregadas</span></div></div>
        <div class="tarjeta"><div class="fila entre"><h2 style="margin:0">Cumplimiento de plazos por funcionario</h2><button class="btn sec chico" onclick="App.descargarCSV()">⬇ Descargar detalle (Excel/CSV)</button></div>
        <div class="leyenda"><span><span class="punto p-verde"></span> ≥ 90 % en plazo</span><span><span class="punto p-amarillo"></span> 70–89 %</span><span><span class="punto p-rojo"></span> &lt; 70 %</span></div>
        <div class="tabla-wrap"><table><thead><tr><th>Funcionario</th><th class="num">Solicitudes</th><th class="num">En plazo</th><th class="num">Fuera de plazo</th><th class="num">Urgentes</th><th class="num">Anuladas</th><th>% en plazo</th><th class="num">Unid. entregadas</th></tr></thead><tbody>
        ${r.personas.map(x => `<tr><td>${esc(x.nombre)}</td><td class="num">${x.solicitudes}</td><td class="num">${x.en_plazo}</td><td class="num">${x.fuera_plazo}</td><td class="num">${x.urgentes}</td><td class="num">${x.anuladas}</td><td>${sem(x.pct_en_plazo)}</td><td class="num">${num(x.unidades_entregadas)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Sin solicitudes en el período.</td></tr>'}</tbody></table></div></div>
        <div class="tarjeta"><h2>Consumo de insumos (entregado por bodega)</h2><p class="muted pequeno">Unidades como las registra AVIS. Toque un producto para ver cuánto retiró cada funcionario.</p>
        <div class="tabla-wrap"><table><thead><tr><th>Producto (AVIS)</th><th>Categoría</th><th class="num">Solicitado</th><th class="num">Entregado</th><th style="min-width:140px"></th></tr></thead><tbody>
        ${r.productos.map((x, k) => `<tr style="cursor:pointer" onclick="App.detalleConsumo(${k})"><td>${esc(x.nombre)}</td><td class="pequeno">${esc(x.categoria)}</td><td class="num">${num(x.solicitado)}</td><td class="num"><b>${num(x.entregado)}</b></td>
          <td><div style="height:8px;background:var(--azul-claro);border-radius:5px"><div style="height:8px;width:${Math.round(x.entregado * 100 / maxE)}%;background:var(--azul-2);border-radius:5px"></div></div></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin consumo en el período.</td></tr>'}</tbody></table></div></div>
        <div class="tarjeta"><h2>Por lugar de entrega</h2>${r.boxes.map(b => `<div class="item-sol"><span>${esc(b.box)}</span><span>${b.solicitudes} solicitudes · <b>${num(b.entregado)}</b> unidades</span></div>`).join('') || '<p class="muted">—</p>'}</div>`;
    });
  }
  function detalleConsumo(k) {
    const x = S.reporte.productos[k];
    modal(`<h2>${esc(x.nombre)}</h2><p class="muted">${fecha(S.reporte.desde)} al ${fecha(S.reporte.hasta)} · ${x.solicitudes} solicitudes</p>
      ${Object.entries(x.por_persona).sort((a, b) => b[1] - a[1]).map(([n, v]) => `<div class="item-sol"><span>${esc(n)}</span><b>${num(v)}</b></div>`).join('')}
      <p><button class="btn sec bloque" onclick="App.cerrarModal()">Cerrar</button></p>`);
  }
  function descargarCSV() {
    const r = S.reporte; if (!r) return;
    const q = v => { const t = String(v === null || v === undefined ? '' : v); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const csv = '\uFEFF' + [r.detalle_columnas].concat(r.detalle).map(f => f.map(q).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'consumo_' + r.desde + '_al_' + r.hasta + '.csv'; document.body.appendChild(a); a.click(); a.remove();
  }
  const CAMPOS_CFG = [['NOMBRE_UNIDAD', 'Nombre de la unidad (aparece en correos e informes)'], ['NOMBRE_DROGUERIA', 'Nombre destinatario Droguería'], ['CORREO_DROGUERIA', 'Correo encargado/a de Droguería (planilla Farmacia)'],
    ['NOMBRE_BODEGA_CENTRAL', 'Nombre destinatario Bodega Central'], ['CORREO_BODEGA_CENTRAL', 'Correo encargada de Bodega Central Dental'], ['CORREOS_COPIA', 'Correos en copia de todos los envíos (separados por coma)'],
    ['CORREOS_AVISO_SOLICITUD', 'Correos que reciben aviso de cada nueva solicitud de TONS (vacío = sin aviso)'], ['SEGURIDAD_PCT', '% de seguridad para el pedido sugerido'],
    ['BOXES', 'Lugares de entrega (separados por coma)'], ['AVISO_VIGENCIA_DIAS', 'Días de anticipación para avisar vencimiento de accesos']];
  async function vConfig() {
    V('<div class="vacio"><div class="spinner"></div></div>');
    await intentar(async () => {
      const c = await api('config', {}, { silencioso: true });
      if (S.vista !== 'config') return;
      V(`<div class="tarjeta"><h2>Plazos de pedido</h2><label>Solicitudes hechas fuera de plazo</label><select id="cfg_PLAZO_MODO"><option value="MARCAR">Se aceptan y quedan marcadas como fuera de plazo</option><option value="BLOQUEAR">Se bloquean, salvo urgentes con motivo escrito</option></select></div>
        <div class="tarjeta"><h2>Datos de envío</h2>${CAMPOS_CFG.map(x => `<label>${x[1]}</label><input id="cfg_${x[0]}" value="${esc(c[x[0]])}">`).join('')}
        <p><button class="btn ok bloque" onclick="App.guardarConfig()">Guardar configuración</button></p></div>
        <div class="tarjeta"><h2>Plantillas oficiales</h2>
        <p>Planilla Farmacia (abastecimiento): <span class="estado ${c.plantilla_farmacia ? 'e-verde">Registrada' : 'e-rojo">Falta'}</span></p>
        <p>Planilla Bodega Central: <span class="estado ${c.plantilla_bodega ? 'e-verde">Registrada' : 'e-rojo">Falta'}</span></p>
        <p class="enlaces">${c.carpeta_url ? `<a href="${c.carpeta_url}" target="_blank">Abrir carpeta del sistema en Drive</a>` : ''}<a href="${c.planilla_datos_url}" target="_blank">Abrir base de datos</a></p></div>`);
      $('#cfg_PLAZO_MODO').value = c.PLAZO_MODO === 'BLOQUEAR' ? 'BLOQUEAR' : 'MARCAR';
    });
  }
  async function guardarConfig() {
    const d = { PLAZO_MODO: $('#cfg_PLAZO_MODO').value }; CAMPOS_CFG.forEach(x => d[x[0]] = $('#cfg_' + x[0]).value);
    await intentar(async () => { await api('guardarConfig', d); toast('Configuración guardada.'); });
  }

  /* ---------------- Utilidades de UI ---------------- */
  let tBuscar;
  function buscar(v) { S.q = v; clearTimeout(tBuscar); tBuscar = setTimeout(pintarLista, 150); }
  function buscarAdmin(v) { S.filtro.qa = v; clearTimeout(tBuscar); tBuscar = setTimeout(pintarCatAdmin, 150); }
  function categoria(c) { S.cat = c; vCatalogo(); }
  function filtrar(k, v) {
    S.filtro[k] = v;
    ({ bandeja: vBandeja, corteTab: pintarCorte, soloPedido: pintarCorte, recep: pintarRecepcion, cat: () => vCatAdmin(), usu: pintarUsuarios })[k]();
  }
  async function instalarApp() { if (!S.instalar) return; S.instalar.prompt(); await S.instalar.userChoice; S.instalar = null; render(); }

  const VISTAS = { catalogo: vCatalogo, carrito: vCarrito, mis: vMis, perfil: vPerfil, bandeja: vBandeja, corte: vCorte, recepcion: vRecepcion, catadmin: () => vCatAdmin(), usuarios: vUsuarios, config: vConfig, mas: vMas, plazos: vPlazos, reportes: vReportes };

  window.App = { login, logout, cambiarClave, ir, refrescar, buscar, buscarAdmin, categoria, filtrar, sumar, fijar, verFoto, cerrarModal, vaciarCarrito, enviarSolicitud, anular,
    atender, confirmarAtencion, rechazar: id => { if (confirm('¿Rechazar toda la solicitud?')) confirmarAtencion(id, true); }, marcarAvis,
    importarAvis, crearCorte, abrirCorte, editarCorte, guardarCorte: () => guardarCorte(false), conformarCorte, reabrirCorte, eliminarCorte, salirCorte, enviarCorteForm, enviarCorte,
    leerDespacho, crearRecepcion, abrirRecepcion, editarRecep, guardarRecepcion: () => guardarRecepcion(false), cerrarRecepcion, salirRecepcion, enviarRecepcionForm, enviarRecepcion,
    editarProducto, filasPlanilla: () => filasPlanilla(), guardarProducto, subirFoto, quitarFoto, importarFotosForm, leerFotosPlanilla, cargarFotosPlanilla, editarUsuario, tipoContrato, guardarUsuario, resetClave, guardarConfig, instalarApp,
    guardarPlazo: id => guardarPlazo(typeof id === 'string' ? id : ''), editarPlazo, eliminarPlazo, generarReporte, detalleConsumo, descargarCSV };

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.instalar = e; if (S.vista === 'perfil') render(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
  if (S.token && S.usuario) cargarInicio();
})();
