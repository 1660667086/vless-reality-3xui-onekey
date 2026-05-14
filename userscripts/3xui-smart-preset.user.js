// ==UserScript==
// @name         3x-ui 入站智能伪装预设
// @namespace    https://github.com/1660667086/vless-reality-3xui-onekey
// @version      0.1.0
// @description  在 3x-ui 添加入站时，按协议自动补全推荐伪装参数，减少手动配置错误。
// @match        http://*/panel/inbounds*
// @match        https://*/panel/inbounds*
// @match        http://*/*/panel/inbounds*
// @match        https://*/*/panel/inbounds*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const REALITY_TARGETS = [
    { target: 'www.microsoft.com:443', sni: 'www.microsoft.com' },
    { target: 'www.apple.com:443', sni: 'www.apple.com' },
    { target: 'www.cloudflare.com:443', sni: 'www.cloudflare.com' },
    { target: 'www.amazon.com:443', sni: 'www.amazon.com' },
  ];

  function basePath() {
    const path = window.location.pathname;
    const idx = path.indexOf('/panel/');
    return idx >= 0 ? path.slice(0, idx + 1) : '/';
  }

  function randomHex(bytes) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function pickRealityTarget() {
    return REALITY_TARGETS[Math.floor(Math.random() * REALITY_TARGETS.length)];
  }

  function parseJson(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (_e) {
      return fallback;
    }
  }

  function sniffingPreset() {
    return {
      enabled: true,
      destOverride: ['http', 'tls', 'quic'],
      metadataOnly: false,
      routeOnly: false,
    };
  }

  function getX25519KeypairSync() {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${basePath()}panel/api/server/getNewX25519Cert`, false);
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.send(null);
    if (xhr.status < 200 || xhr.status >= 300) {
      throw new Error(`X25519 API HTTP ${xhr.status}`);
    }
    const msg = JSON.parse(xhr.responseText);
    if (!msg?.success || !msg.obj?.privateKey || !msg.obj?.publicKey) {
      throw new Error('X25519 API 返回无效');
    }
    return msg.obj;
  }

  function realityStreamPreset() {
    const keys = getX25519KeypairSync();
    const picked = pickRealityTarget();
    return {
      network: 'tcp',
      security: 'reality',
      externalProxy: [],
      realitySettings: {
        show: false,
        xver: 0,
        target: picked.target,
        serverNames: [picked.sni],
        privateKey: keys.privateKey,
        minClientVer: '',
        maxClientVer: '',
        maxTimeDiff: 0,
        maxTimediff: 0,
        shortIds: [randomHex(8)],
        mldsa65Seed: '',
        settings: {
          publicKey: keys.publicKey,
          fingerprint: 'chrome',
          serverName: picked.sni,
          spiderX: '/',
          mldsa65Verify: '',
        },
      },
      tcpSettings: {
        acceptProxyProtocol: false,
        header: { type: 'none' },
      },
      sockopt: {
        acceptProxyProtocol: false,
        tcpFastOpen: false,
        tproxy: 'off',
      },
    };
  }

  function applyVlessPreset(params) {
    const settings = parseJson(params.get('settings'), {});
    settings.clients = Array.isArray(settings.clients) ? settings.clients : [];
    settings.decryption = 'none';
    settings.fallbacks = [];
    for (const client of settings.clients) {
      client.flow = 'xtls-rprx-vision';
      if (client.enable == null) client.enable = true;
    }
    params.set('settings', JSON.stringify(settings));
    params.set('streamSettings', JSON.stringify(realityStreamPreset()));
    params.set('sniffing', JSON.stringify(sniffingPreset()));
    return '已套用 VLESS + REALITY + Vision + uTLS(chrome) 推荐预设';
  }

  function applyTrojanPreset(params) {
    const settings = parseJson(params.get('settings'), {});
    settings.clients = Array.isArray(settings.clients) ? settings.clients : [];
    settings.fallbacks = [];
    for (const client of settings.clients) {
      if (client.enable == null) client.enable = true;
    }
    params.set('settings', JSON.stringify(settings));
    params.set('streamSettings', JSON.stringify(realityStreamPreset()));
    params.set('sniffing', JSON.stringify(sniffingPreset()));
    return '已套用 Trojan + REALITY + uTLS(chrome) 推荐预设';
  }

  function applyHysteriaPreset(params) {
    const stream = parseJson(params.get('streamSettings'), {});
    stream.network = 'hysteria';
    stream.security = 'tls';
    stream.hysteriaSettings = stream.hysteriaSettings || {
      protocol: 'udp',
      version: '2',
      auth: '',
      udpIdleTimeout: 60,
    };
    params.set('streamSettings', JSON.stringify(stream));
    params.set('sniffing', JSON.stringify(sniffingPreset()));
    return '已套用 Hysteria 基础 TLS/QUIC 预设';
  }

  function applySafeDefaults(params) {
    const protocol = params.get('protocol');
    if (protocol === 'vless') return applyVlessPreset(params);
    if (protocol === 'trojan') return applyTrojanPreset(params);
    if (protocol === 'hysteria') return applyHysteriaPreset(params);

    // Shadowsocks / WireGuard / mixed / http / tunnel / tun 没有和 REALITY
    // 类似的网页伪装参数。这里保留面板原配置，避免制造错误。
    return '';
  }

  function toast(text, type = 'success') {
    if (!text) return;
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'left:50%',
      'top:18px',
      'transform:translateX(-50%)',
      'padding:10px 14px',
      'border-radius:8px',
      'font-size:14px',
      'font-weight:600',
      'color:#fff',
      `background:${type === 'error' ? '#d93025' : '#1677ff'}`,
      'box-shadow:0 8px 30px rgba(0,0,0,.28)',
    ].join(';');
    document.documentElement.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function transformBody(body) {
    if (typeof body !== 'string') return body;
    const params = new URLSearchParams(body);
    const protocol = params.get('protocol');
    if (!protocol) return body;
    const msg = applySafeDefaults(params);
    if (msg) toast(msg);
    return params.toString();
  }

  const rawOpen = XMLHttpRequest.prototype.open;
  const rawSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__xuiSmartPresetAddInbound = method?.toUpperCase?.() === 'POST'
      && String(url).includes('/panel/api/inbounds/add');
    return rawOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this.__xuiSmartPresetAddInbound) {
      try {
        return rawSend.call(this, transformBody(body));
      } catch (e) {
        toast(`智能预设失败：${e.message}`, 'error');
      }
    }
    return rawSend.apply(this, arguments);
  };
})();
