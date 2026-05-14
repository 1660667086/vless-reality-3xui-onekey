// ==UserScript==
// @name         3x-ui 入站智能伪装预设
// @namespace    https://github.com/1660667086/vless-reality-3xui-onekey
// @version      0.3.0
// @description  在 3x-ui 添加入站时，按协议自动补全推荐伪装参数，减少手动配置错误。
// @match        http://*/panel/inbounds*
// @match        https://*/panel/inbounds*
// @match        http://*/*/panel/inbounds*
// @match        https://*/*/panel/inbounds*
// @downloadURL  https://raw.githubusercontent.com/1660667086/vless-reality-3xui-onekey/main/userscripts/3xui-smart-preset.user.js
// @updateURL    https://raw.githubusercontent.com/1660667086/vless-reality-3xui-onekey/main/userscripts/3xui-smart-preset.user.js
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

  const SS_METHOD = '2022-blake3-aes-256-gcm';

  class Wireguard {
    static gf(init) {
      const r = new Float64Array(16);
      if (init) {
        for (let i = 0; i < init.length; ++i) r[i] = init[i];
      }
      return r;
    }

    static pack(o, n) {
      let b;
      const m = this.gf();
      const t = this.gf();
      for (let i = 0; i < 16; ++i) t[i] = n[i];
      this.carry(t);
      this.carry(t);
      this.carry(t);
      for (let j = 0; j < 2; ++j) {
        m[0] = t[0] - 0xffed;
        for (let i = 1; i < 15; ++i) {
          m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1);
          m[i - 1] &= 0xffff;
        }
        m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
        b = (m[15] >> 16) & 1;
        m[14] &= 0xffff;
        this.cswap(t, m, 1 - b);
      }
      for (let i = 0; i < 16; ++i) {
        o[2 * i] = t[i] & 0xff;
        o[2 * i + 1] = t[i] >> 8;
      }
    }

    static carry(o) {
      for (let i = 0; i < 16; ++i) {
        o[(i + 1) % 16] += (i < 15 ? 1 : 38) * Math.floor(o[i] / 65536);
        o[i] &= 0xffff;
      }
    }

    static cswap(p, q, b) {
      const c = ~(b - 1);
      for (let i = 0; i < 16; ++i) {
        const t = c & (p[i] ^ q[i]);
        p[i] ^= t;
        q[i] ^= t;
      }
    }

    static add(o, a, b) {
      for (let i = 0; i < 16; ++i) o[i] = (a[i] + b[i]) | 0;
    }

    static subtract(o, a, b) {
      for (let i = 0; i < 16; ++i) o[i] = (a[i] - b[i]) | 0;
    }

    static multmod(o, a, b) {
      const t = new Float64Array(31);
      for (let i = 0; i < 16; ++i) {
        for (let j = 0; j < 16; ++j) t[i + j] += a[i] * b[j];
      }
      for (let i = 0; i < 15; ++i) t[i] += 38 * t[i + 16];
      for (let i = 0; i < 16; ++i) o[i] = t[i];
      this.carry(o);
      this.carry(o);
    }

    static invert(o, i) {
      const c = this.gf();
      for (let a = 0; a < 16; ++a) c[a] = i[a];
      for (let a = 253; a >= 0; --a) {
        this.multmod(c, c, c);
        if (a !== 2 && a !== 4) this.multmod(c, c, i);
      }
      for (let a = 0; a < 16; ++a) o[a] = c[a];
    }

    static clamp(z) {
      z[31] = (z[31] & 127) | 64;
      z[0] &= 248;
    }

    static generatePublicKey(privateKey) {
      let r;
      const z = new Uint8Array(32);
      const a = this.gf([1]);
      const b = this.gf([9]);
      const c = this.gf();
      const d = this.gf([1]);
      const e = this.gf();
      const f = this.gf();
      const _121665 = this.gf([0xdb41, 1]);
      const _9 = this.gf([9]);
      for (let i = 0; i < 32; ++i) z[i] = privateKey[i];
      this.clamp(z);
      for (let i = 254; i >= 0; --i) {
        r = (z[i >>> 3] >>> (i & 7)) & 1;
        this.cswap(a, b, r);
        this.cswap(c, d, r);
        this.add(e, a, c);
        this.subtract(a, a, c);
        this.add(c, b, d);
        this.subtract(b, b, d);
        this.multmod(d, e, e);
        this.multmod(f, a, a);
        this.multmod(a, c, a);
        this.multmod(c, b, e);
        this.add(e, a, c);
        this.subtract(a, a, c);
        this.multmod(b, a, a);
        this.subtract(c, d, f);
        this.multmod(a, c, _121665);
        this.add(a, a, d);
        this.multmod(c, c, a);
        this.multmod(a, d, f);
        this.multmod(d, b, _9);
        this.multmod(b, e, e);
        this.cswap(a, b, r);
        this.cswap(c, d, r);
      }
      this.invert(c, c);
      this.multmod(a, a, c);
      this.pack(z, a);
      return z;
    }

    static generatePrivateKey() {
      const privateKey = new Uint8Array(32);
      crypto.getRandomValues(privateKey);
      this.clamp(privateKey);
      return privateKey;
    }

    static encodeBase64(dest, src) {
      const input = Uint8Array.from([
        (src[0] >> 2) & 63,
        ((src[0] << 4) | (src[1] >> 4)) & 63,
        ((src[1] << 2) | (src[2] >> 6)) & 63,
        src[2] & 63,
      ]);
      for (let i = 0; i < 4; ++i) {
        dest[i] = input[i] + 65
          + (((25 - input[i]) >> 8) & 6)
          - (((51 - input[i]) >> 8) & 75)
          - (((61 - input[i]) >> 8) & 15)
          + (((62 - input[i]) >> 8) & 3);
      }
    }

    static keyToBase64(key) {
      return btoa(String.fromCharCode(...key));
    }

    static generateKeypair() {
      const privateKey = this.generatePrivateKey();
      const publicKey = this.generatePublicKey(privateKey);
      return {
        publicKey: this.keyToBase64(publicKey),
        privateKey: this.keyToBase64(privateKey),
      };
    }
  }

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

  function randomSeq(count, chars = 'abcdefghijklmnopqrstuvwxyz0123456789') {
    const values = new Uint32Array(count);
    crypto.getRandomValues(values);
    return Array.from(values, (v) => chars[v % chars.length]).join('');
  }

  function randomBase64Bytes(length) {
    const buf = new Uint8Array(length);
    crypto.getRandomValues(buf);
    return btoa(String.fromCharCode(...buf));
  }

  function randomSSPassword(method = SS_METHOD) {
    return randomBase64Bytes(method === '2022-blake3-aes-128-gcm' ? 16 : 32);
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

  function getJsonSync(method, url) {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${basePath()}${url.replace(/^\/+/, '')}`, false);
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
    xhr.send(null);
    if (xhr.status < 200 || xhr.status >= 300) {
      throw new Error(`${url} HTTP ${xhr.status}`);
    }
    return JSON.parse(xhr.responseText);
  }

  function getX25519KeypairSync() {
    const msg = getJsonSync('GET', '/panel/api/server/getNewX25519Cert');
    if (!msg?.success || !msg.obj?.privateKey || !msg.obj?.publicKey) {
      throw new Error('X25519 API 返回无效');
    }
    return msg.obj;
  }

  function getDefaultCertSettingsSync() {
    try {
      const msg = getJsonSync('POST', '/panel/setting/defaultSettings');
      if (msg?.success && msg.obj?.defaultCert && msg.obj?.defaultKey) {
        return {
          certFile: msg.obj.defaultCert,
          keyFile: msg.obj.defaultKey,
        };
      }
    } catch (_e) {
      // 没有默认 TLS 证书时继续填基础结构，避免影响其他协议。
    }
    return { certFile: '', keyFile: '' };
  }

  function requireDefaultCert(protocol) {
    const cert = getDefaultCertSettingsSync();
    if (!cert.certFile || !cert.keyFile) {
      throw new Error(`${protocol} 安全预设需要先在 3x-ui 面板设置默认 TLS 证书`);
    }
    return cert;
  }

  function sniffingPreset(enabled = true) {
    return {
      enabled,
      destOverride: ['http', 'tls', 'quic'],
      metadataOnly: false,
      routeOnly: false,
    };
  }

  function ensureClients(settings, maker) {
    const clients = Array.isArray(settings.clients) && settings.clients.length > 0
      ? settings.clients
      : [{}];
    settings.clients = clients.map((client, index) => ({
      email: client.email || `user${index + 1}-${randomSeq(5)}`,
      enable: client.enable ?? true,
      limitIp: client.limitIp ?? 0,
      totalGB: client.totalGB ?? 0,
      expiryTime: client.expiryTime ?? 0,
      tgId: client.tgId ?? '',
      subId: client.subId || randomSeq(16),
      ...client,
      ...maker(client, index),
    }));
  }

  function strongProxyAccounts(accounts) {
    const source = Array.isArray(accounts) && accounts.length > 0 ? accounts : [{}];
    return source.map((account) => ({
      ...account,
      user: typeof account.user === 'string' && account.user.length >= 8
        ? account.user
        : `u${randomSeq(12)}`,
      pass: typeof account.pass === 'string' && account.pass.length >= 20
        ? account.pass
        : randomBase64Bytes(24),
    }));
  }

  function tlsSettingsPreset(alpn = ['h3'], cert = getDefaultCertSettingsSync()) {
    return {
      serverName: '',
      minVersion: '1.2',
      maxVersion: '1.3',
      cipherSuites: '',
      rejectUnknownSni: false,
      disableSystemRoot: false,
      enableSessionResumption: false,
      certificates: [{
        certificateFile: cert.certFile,
        keyFile: cert.keyFile,
        oneTimeLoading: false,
        usage: 'encipherment',
        buildChain: false,
      }],
      alpn,
      echServerKeys: '',
      settings: {
        fingerprint: 'chrome',
        echConfigList: '',
      },
    };
  }

  function tlsTcpStreamPreset(cert) {
    return {
      network: 'tcp',
      security: 'tls',
      externalProxy: [],
      tlsSettings: tlsSettingsPreset(['h2', 'http/1.1'], cert),
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

  function plainTcpStreamPreset() {
    return {
      network: 'tcp',
      security: 'none',
      externalProxy: [],
      tcpSettings: {
        acceptProxyProtocol: false,
        header: { type: 'none' },
      },
    };
  }

  function applyVlessPreset(params) {
    const settings = parseJson(params.get('settings'), {});
    ensureClients(settings, () => ({ flow: 'xtls-rprx-vision' }));
    settings.decryption = 'none';
    settings.fallbacks = [];
    params.set('settings', JSON.stringify(settings));
    params.set('streamSettings', JSON.stringify(realityStreamPreset()));
    params.set('sniffing', JSON.stringify(sniffingPreset()));
    return '已套用 VLESS + REALITY + Vision + uTLS(chrome) 推荐预设';
  }

  function applyTrojanPreset(params) {
    const settings = parseJson(params.get('settings'), {});
    ensureClients(settings, (client) => ({ password: client.password || randomSeq(16) }));
    settings.fallbacks = [];
    params.set('settings', JSON.stringify(settings));
    params.set('streamSettings', JSON.stringify(realityStreamPreset()));
    params.set('sniffing', JSON.stringify(sniffingPreset()));
    return '已套用 Trojan + REALITY + uTLS(chrome) 推荐预设';
  }

  function applyHysteriaPreset(params) {
    const settings = parseJson(params.get('settings'), {});
    const stream = parseJson(params.get('streamSettings'), {});
    const picked = pickRealityTarget();
    const cert = requireDefaultCert('Hysteria2');
    settings.version = 2;
    ensureClients(settings, (client) => ({ auth: client.auth || randomSeq(24) }));
    stream.network = 'hysteria';
    stream.security = 'tls';
    stream.externalProxy = [];
    stream.tlsSettings = tlsSettingsPreset(['h3'], cert);
    stream.hysteriaSettings = {
      protocol: 'udp',
      version: 2,
      auth: randomBase64Bytes(32),
      udpIdleTimeout: 60,
      masquerade: {
        type: 'proxy',
        dir: '',
        url: `https://${picked.sni}`,
        rewriteHost: true,
        insecure: false,
        content: '',
        headers: {},
        statusCode: 0,
      },
    };
    params.set('settings', JSON.stringify(settings));
    params.set('streamSettings', JSON.stringify(stream));
    params.set('sniffing', JSON.stringify(sniffingPreset()));
    return '已套用 Hysteria2 + TLS(h3) + Masquerade + 强随机认证安全预设';
  }

  function applyShadowsocksPreset(params) {
    const settings = parseJson(params.get('settings'), {});
    const cert = requireDefaultCert('Shadowsocks');
    settings.method = SS_METHOD;
    settings.password = randomSSPassword(SS_METHOD);
    settings.network = 'tcp';
    settings.ivCheck = true;
    ensureClients(settings, (client) => ({
      method: '',
      password: client.password && client.password.length > 20 ? client.password : randomSSPassword(SS_METHOD),
    }));
    params.set('settings', JSON.stringify(settings));
    params.set('streamSettings', JSON.stringify(tlsTcpStreamPreset(cert)));
    params.set('sniffing', JSON.stringify(sniffingPreset()));
    return '已套用 Shadowsocks 2022 + TCP-only + TLS + ivCheck 安全预设';
  }

  function applyWireguardPreset(params) {
    const server = Wireguard.generateKeypair();
    const peer = Wireguard.generateKeypair();
    const settings = {
      mtu: 1280,
      secretKey: server.privateKey,
      peers: [{
        privateKey: peer.privateKey,
        publicKey: peer.publicKey,
        allowedIPs: ['10.66.66.2/32'],
        keepAlive: 25,
      }],
      noKernelTun: false,
    };
    params.set('settings', JSON.stringify(settings));
    params.set('streamSettings', '');
    params.set('sniffing', JSON.stringify(sniffingPreset(false)));
    return '已套用 WireGuard 自动密钥 + MTU 1280 + KeepAlive 安全预设';
  }

  function applyMixedPreset(params) {
    const settings = parseJson(params.get('settings'), {});
    params.set('listen', '127.0.0.1');
    settings.auth = 'password';
    settings.accounts = strongProxyAccounts(settings.accounts);
    settings.udp = false;
    settings.ip = settings.ip || '127.0.0.1';
    params.set('settings', JSON.stringify(settings));
    params.set('streamSettings', '');
    params.set('sniffing', JSON.stringify(sniffingPreset()));
    return '已套用 Mixed 本地监听 127.0.0.1 + 强账号密码 + 关闭 UDP 安全预设';
  }

  function applyHttpPreset(params) {
    const settings = parseJson(params.get('settings'), {});
    params.set('listen', '127.0.0.1');
    settings.accounts = strongProxyAccounts(settings.accounts);
    settings.allowTransparent = false;
    params.set('settings', JSON.stringify(settings));
    params.set('streamSettings', '');
    params.set('sniffing', JSON.stringify(sniffingPreset()));
    return '已套用 HTTP 本地监听 127.0.0.1 + 强账号密码安全预设';
  }

  function applyTunnelPreset(params) {
    const settings = parseJson(params.get('settings'), {});
    params.set('listen', '127.0.0.1');
    settings.rewriteAddress = settings.rewriteAddress || '127.0.0.1';
    settings.rewritePort = Number(settings.rewritePort) || 80;
    settings.portMap = settings.portMap && typeof settings.portMap === 'object' ? settings.portMap : {};
    settings.allowedNetwork = 'tcp';
    settings.followRedirect = false;
    params.set('settings', JSON.stringify(settings));
    params.set('streamSettings', '');
    params.set('sniffing', JSON.stringify(sniffingPreset(false)));
    return '已套用 Tunnel 本地监听 127.0.0.1 + TCP-only + 禁止透明转发安全预设';
  }

  function applyTunPreset(params) {
    const settings = parseJson(params.get('settings'), {});
    params.set('listen', '127.0.0.1');
    settings.name = settings.name || 'xray0';
    settings.mtu = Number(settings.mtu) || 1280;
    settings.gateway = Array.isArray(settings.gateway) && settings.gateway.length > 0
      ? settings.gateway
      : ['10.66.0.1/16'];
    settings.dns = Array.isArray(settings.dns) && settings.dns.length > 0
      ? settings.dns
      : ['1.1.1.1', '8.8.8.8'];
    settings.userLevel = settings.userLevel || 0;
    settings.autoSystemRoutingTable = Array.isArray(settings.autoSystemRoutingTable)
      ? settings.autoSystemRoutingTable
      : [];
    settings.autoOutboundsInterface = settings.autoOutboundsInterface || 'auto';
    params.set('settings', JSON.stringify(settings));
    params.set('streamSettings', '');
    params.set('sniffing', JSON.stringify(sniffingPreset(false)));
    return '已套用 TUN 本地监听 127.0.0.1 + MTU 1280 + DNS 安全预设';
  }

  function applySafeDefaults(params) {
    const protocol = params.get('protocol');
    if (protocol === 'vless') return applyVlessPreset(params);
    if (protocol === 'trojan') return applyTrojanPreset(params);
    if (protocol === 'hysteria') return applyHysteriaPreset(params);
    if (protocol === 'shadowsocks') return applyShadowsocksPreset(params);
    if (protocol === 'wireguard') return applyWireguardPreset(params);
    if (protocol === 'mixed') return applyMixedPreset(params);
    if (protocol === 'http') return applyHttpPreset(params);
    if (protocol === 'tunnel') return applyTunnelPreset(params);
    if (protocol === 'tun') return applyTunPreset(params);
    return '';
  }

  function toast(text, type = 'success') {
    if (!text || !document.documentElement) return;
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
    setTimeout(() => el.remove(), 3500);
  }

  function transformParams(params) {
    const protocol = params.get('protocol');
    if (!protocol) return '';
    const msg = applySafeDefaults(params);
    if (msg) toast(msg);
    return msg;
  }

  function transformBody(body) {
    if (typeof body === 'string') {
      const params = new URLSearchParams(body);
      return transformParams(params) ? params.toString() : body;
    }
    if (body instanceof URLSearchParams) {
      const params = new URLSearchParams(body.toString());
      return transformParams(params) ? params : body;
    }
    return body;
  }

  function isAddInbound(method, url) {
    return method?.toUpperCase?.() === 'POST'
      && String(url).includes('/panel/api/inbounds/add');
  }

  const rawOpen = XMLHttpRequest.prototype.open;
  const rawSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__xuiSmartPresetAddInbound = isAddInbound(method, url);
    return rawOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this.__xuiSmartPresetAddInbound) {
      try {
        return rawSend.call(this, transformBody(body));
      } catch (e) {
        toast(`智能预设失败：${e.message}`, 'error');
        throw e;
      }
    }
    return rawSend.apply(this, arguments);
  };

  if (typeof window.fetch === 'function') {
    const rawFetch = window.fetch.bind(window);
    window.fetch = function (input, init = {}) {
      const url = typeof input === 'string' ? input : input?.url;
      const method = init.method || input?.method || 'GET';
      if (isAddInbound(method, url) && init.body) {
        try {
          return rawFetch(input, { ...init, body: transformBody(init.body) });
        } catch (e) {
          toast(`智能预设失败：${e.message}`, 'error');
          return Promise.reject(e);
        }
      }
      return rawFetch(input, init);
    };
  }
})();
