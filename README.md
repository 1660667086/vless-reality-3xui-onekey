# VLESS REALITY Vision + 3x-ui 一键脚本

这个脚本会在你有权限管理的 Linux VPS 上安装 3x-ui Web 面板，并自动创建一个 `VLESS + TCP + REALITY + Vision` 入站节点。首批用户可以一次性创建，每个用户都能设置到期天数、流量和 IP 数限制。

## 一键安装

把脚本上传到服务器后执行：

```bash
sudo bash install-vless-reality-3xui.sh
```

安装完成后会输出：

- 3x-ui 面板地址、用户名、密码
- 入站节点端口、REALITY 公钥、short ID
- 每个用户的 `vless://` 分享链接
- 结果备份文件：`/root/3x-ui-reality-install-*.txt`

## 多用户和到期时间

用 `USERS` 一次创建多个用户，格式是：

```text
用户名:到期天数:流量GB:IP限制,用户名2:到期天数:流量GB:IP限制
```

例子：

```bash
sudo env USERS='alice:30:100:2,bob:7:0:0,charlie:90:300:3' \
  bash install-vless-reality-3xui.sh
```

含义：

- `alice:30:100:2`：30 天到期，100 GB 流量，最多 2 个 IP
- `bob:7:0:0`：7 天到期，流量不限，IP 不限制
- 到期天数 `0` 表示永不过期
- 流量 `0` 表示不限流量
- IP 限制 `0` 表示不限制

后续继续加用户、改到期时间、停用用户，直接进 3x-ui Web 面板的 `Inbounds -> Clients` 操作即可。

## 常用参数

```bash
sudo env \
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

也可以用命令参数：

```bash
sudo bash install-vless-reality-3xui.sh \
  --panel-port 25443 \
  --inbound-port 443 \
  --sni www.microsoft.com \
  --users 'u1:30:100:2,u2:60:0:0'
```

## 只装面板

如果你想自己在面板里手动配置入站节点：

```bash
sudo bash install-vless-reality-3xui.sh --no-inbound
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

## 参考

- 3x-ui: https://github.com/MHSanaei/3x-ui
- Xray REALITY / uTLS transport: https://xtls.github.io/en/config/transport.html
- Xray VLESS Vision inbound: https://xtls.github.io/en/config/inbounds/vless.html
