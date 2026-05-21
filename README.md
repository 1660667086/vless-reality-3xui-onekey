# VLESS REALITY Vision + 3x-ui 一键脚本

这个脚本会在你有权限管理的 Linux VPS 上安装 3x-ui Web 面板，并自动创建一个 `VLESS + TCP + REALITY + Vision` 入站节点。首批用户可以一次性创建，每个用户都能设置到期天数、流量和 IP 数限制。

## 一键安装

新机器完整一键安装直接执行，不要带 `--hysteria-cert-only`。脚本会自动识别权限：root 直接安装；普通用户会自动调用 `sudo`；极简系统没有 `sudo` 时，先切换到 root 后运行同一条命令即可。

通用拉取安装：

```bash
curl -fsSL -o install-vless-reality-3xui.sh \
  https://raw.githubusercontent.com/1660667086/vless-reality-3xui-onekey/main/install-vless-reality-3xui.sh
chmod +x install-vless-reality-3xui.sh
bash install-vless-reality-3xui.sh
```

已经下载好脚本时：

```bash
bash install-vless-reality-3xui.sh
```

完整安装会一次完成：

- 安装 3x-ui Web 面板
- 自动创建 `VLESS + TCP + REALITY + Vision` 入站
- 自动生成 Hysteria2 自签证书和 SHA256 指纹，给浏览器智能预设使用
- 输出面板地址、用户名、密码、客户端链接和证书信息

默认安装源是你自己仓库的 GitHub Release 镜像，不会直接从 3x-ui 官方上游下载面板安装包：

- 镜像仓库：`1660667086/vless-reality-3xui-onekey`
- 镜像 Release：`3x-ui-v3.0.2`
- 安装包格式：`x-ui-linux-<架构>.tar.gz`

安装完成后会输出：

- 3x-ui 面板地址、用户名、密码
- 入站节点端口、REALITY 公钥、short ID
- 每个用户的 `vless://` 分享链接
- 结果备份文件：`/root/3x-ui-reality-install-*.txt`

## 独立安装和上游更新

日常安装默认走你自己的镜像：

```bash
bash install-vless-reality-3xui.sh
```

检查官方 3x-ui 上游是否有新版本：

```bash
bash install-vless-reality-3xui.sh --check-upstream-update
```

确认要更新面板程序时，才从官方上游下载最新版并安装：

```bash
bash install-vless-reality-3xui.sh --update-3xui
```

如果你临时想绕过镜像、直接用官方上游安装，也可以显式指定：

```bash
env INSTALL_SOURCE=upstream bash install-vless-reality-3xui.sh
```

## 多用户和到期时间

用 `USERS` 一次创建多个用户，格式是：

```text
用户名:到期天数:流量GB:IP限制,用户名2:到期天数:流量GB:IP限制
```

例子：

```bash
env USERS='alice:30:100:2,bob:7:0:0,charlie:90:300:3' \
  bash install-vless-reality-3xui.sh
```

含义：

- `alice:30:100:2`：30 天到期，100 GB 流量，最多 2 个 IP
- `bob:7:0:0`：7 天到期，流量不限，IP 不限制
- 到期天数 `0` 表示永不过期
- 流量 `0` 表示不限流量
- IP 限制 `0` 表示不限制

后续继续加用户、改到期时间、停用用户，直接进 3x-ui Web 面板的 `Inbounds -> Clients` 操作即可。

## 推荐伪装预设

不建议在面板里手动填 REALITY、Vision、uTLS、SNI、shortId 等参数，容易少填或填错。面板已安装后，可以直接用脚本创建推荐预设节点：

```bash
env INBOUND_PORT=8443 USERS='newuser:30:100:2' \
  bash install-vless-reality-3xui.sh --preset-only
```

### 面板弹窗自动预设

如果你希望像 3x-ui 原生功能一样：在“添加入站”弹窗里选协议，然后直接点“创建”，可以在浏览器安装：

```text
userscripts/3xui-smart-preset.user.js
```

安装后它会拦截 3x-ui 的“添加入站”请求，在提交前自动补全推荐参数：

- `vless`：自动改成 `VLESS + TCP + REALITY + Vision + uTLS(chrome)`
- `trojan`：自动改成 `Trojan + TCP + REALITY + uTLS(chrome)`
- `hysteria`：按可用的独立 Hysteria2 脚本风格预设为 `Hysteria2 + TLS1.3/h3 + SNI www.bing.com + 自签证书 + skip-cert-verify + Bing 反代伪装 + Salamander 混淆 + BBR QUIC 参数`；脚本会生成 `/usr/local/x-ui/cert/hysteria-selfsigned.crt` 和 `.key` 供 3x-ui 入站使用；二维码和复制链接会自动补 `insecure=1`，如果配置了 SHA256 证书指纹，还会自动补 `pinSHA256` / `fingerprint`，复制 mihomo/Clash YAML 时会自动补 `fingerprint`。Hysteria 会优先尝试 UDP `443`，如果 3x-ui 已有 `443` 入站，会保留当前端口并提示你放行对应 UDP 端口
- `shadowsocks`：有默认 TLS 证书时使用 `Shadowsocks 2022 + TCP-only + TLS + ivCheck`；没有证书时自动降级为 `Shadowsocks 2022 + TCP-only + ivCheck`
- `wireguard`：自动生成服务端和客户端密钥，设置 MTU `1280`、keepalive `25` 和独立内网地址
- `mixed`：默认只监听 `127.0.0.1`，强账号密码，关闭 UDP，避免公网裸露
- `http`：默认只监听 `127.0.0.1`，强账号密码，关闭透明代理
- `tunnel`：默认只监听 `127.0.0.1`，TCP-only，禁止透明转发，默认目标 `127.0.0.1:80`
- `tun`：默认只监听 `127.0.0.1`，`xray0`、MTU `1280`、保守网关和 DNS

注意：这个用户脚本是浏览器侧增强，不改 3x-ui 服务端二进制。它适合现有面板快速使用；如果要真正做进 3x-ui 源码，需要维护自定义 3x-ui 前端构建。

Hysteria2 的 SHA256 证书指纹必须来自实际服务端证书，可以是真实 CA 证书，也可以是脚本生成的自签证书。安装脚本会把自签证书指纹写到：

```bash
/usr/local/x-ui/cert/hysteria-selfsigned.sha256
```

需要手动计算时，在服务器上按你的证书路径执行：

```bash
openssl x509 -noout -fingerprint -sha256 -in /usr/local/x-ui/cert/hysteria-selfsigned.crt
```

然后在 3x-ui 入站页面右下角点击 `HY2 SHA256 未设`，填入指纹并关闭重开二维码。也可以打开浏览器开发者工具 Console 手动保存：

```js
localStorage.setItem('xui_hysteria_pin_sha256', 'AA:BB:CC:...:FF')
```

以后创建 Hysteria2 入站会把这个值写入 TLS 设置；面板二维码和复制 `hysteria2://` 链接时会自动追加 `insecure=1` / `pinSHA256` / `fingerprint`，复制 mihomo/Clash YAML 时会自动追加 `fingerprint`。二维码弹窗会自动切到具体客户端二维码，避免误扫默认的「订阅信息」二维码。如果要取消：

```js
localStorage.removeItem('xui_hysteria_pin_sha256')
```

`--preset-only` 不会重新安装 3x-ui，也不会重置面板账号。它会读取最近的 `/root/3x-ui-reality-install-*.txt` 结果文件里的面板连接信息，然后自动创建：

- `VLESS + TCP + REALITY + Vision`
- uTLS 指纹：`chrome`
- REALITY SNI / 回落目标：默认 `www.microsoft.com`
- 自动生成 X25519 key、short ID、用户 UUID

如果结果文件不存在，可以手动传入面板信息：

```bash
env \
  PANEL_USER='你的面板用户名' \
  PANEL_PASS='你的面板密码' \
  PANEL_PORT=面板端口 \
  PANEL_PATH='面板路径' \
  INBOUND_PORT=8443 \
  USERS='newuser:30:100:2' \
  bash install-vless-reality-3xui.sh --preset-only
```

## 常用参数

```bash
env \
  PANEL_PORT=25443 \
  INBOUND_PORT=443 \
  SERVER_ADDR=你的服务器IP或域名 \
  REALITY_SNI=www.microsoft.com \
  EXPIRE_DAYS=90 \
  TOTAL_GB=200 \
  LIMIT_IP=2 \
  FIRST_USER=user1 \
  bash install-vless-reality-3xui.sh
```

如果 `/tmp` 分区很小，可以指定临时目录和最低空间要求：

```bash
env TMPDIR=/root DISK_MIN_MB=512 bash install-vless-reality-3xui.sh
```

小内存机器会自动识别 swap：默认在内存低于 1GB 且没有 swap 时创建 1GB `/swapfile`，启用后写入 `/etc/fstab`。

```bash
# 不自动创建 swap
bash install-vless-reality-3xui.sh --no-swap

# 改成自动创建 2GB swap
bash install-vless-reality-3xui.sh --swap-size-mb 2048
```

也可以用命令参数：

```bash
bash install-vless-reality-3xui.sh \
  --panel-port 25443 \
  --inbound-port 443 \
  --sni www.microsoft.com \
  --users 'u1:30:100:2,u2:60:0:0'
```

如果面板已经装好，只想给 Hysteria2 预设补上自签证书和 SHA256 指纹，不重置面板、不创建节点：

```bash
bash install-vless-reality-3xui.sh --hysteria-cert-only
```

注意：`--hysteria-cert-only` 不会安装 3x-ui 面板。新机器完整安装请运行不带参数的：

```bash
bash install-vless-reality-3xui.sh
```

## 只装面板

如果你想自己在面板里手动配置入站节点：

```bash
bash install-vless-reality-3xui.sh --no-inbound
```

手动配置建议：

- 协议：`vless`
- 传输 / Network：`tcp`
- 安全：`reality`
- Flow: `xtls-rprx-vision`
- 指纹 / uTLS：`chrome`
- Reality 回落目标：例如 `www.microsoft.com:443`
- SNI / serverNames：例如 `www.microsoft.com`

## 注意

- 默认会开启 BBR，并尝试放行面板端口和节点端口。
- 默认面板是 HTTP 随机端口 + 随机路径；需要 HTTPS 面板证书时，在服务器运行 `x-ui`，进入 SSL Certificate Management。
- 如果 `443` 已被 Nginx/Caddy/Apache 占用，把节点端口改成别的，例如 `INBOUND_PORT=8443`。
- 请只在你拥有或被授权管理的服务器上使用，并遵守所在地法律和服务商条款。

## 常见问题

### No space left on device

这是服务器磁盘空间不足。先检查：

```bash
df -h
df -ih
du -hxd1 / | sort -h
du -hxd1 /var | sort -h
du -hxd1 /root | sort -h
```

Ubuntu / Debian 可先尝试清理：

```bash
apt-get clean
journalctl --vacuum-time=3d
rm -rf /tmp/*
rm -rf /var/tmp/*
```

清理后重新拉取最新版脚本再运行。

## 参考

- 3x-ui: https://github.com/MHSanaei/3x-ui
- Xray REALITY / uTLS transport: https://xtls.github.io/en/config/transport.html
- Xray VLESS Vision inbound: https://xtls.github.io/en/config/inbounds/vless.html
