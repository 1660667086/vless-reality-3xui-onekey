#!/usr/bin/env bash
set -Eeuo pipefail

# 3x-ui + Xray VLESS REALITY Vision 一键安装脚本。
# 请只在你拥有或已获授权管理的 VPS 上使用。

XUI_DIR="/usr/local/x-ui"
XUI_BIN="${XUI_DIR}/x-ui"
XUI_SERVICE_FILE="/etc/systemd/system/x-ui.service"

PANEL_USER="${PANEL_USER:-}"
PANEL_PASS="${PANEL_PASS:-}"
PANEL_PORT="${PANEL_PORT:-}"
PANEL_PATH="${PANEL_PATH:-}"
INBOUND_PORT="${INBOUND_PORT:-443}"
INBOUND_REMARK="${INBOUND_REMARK:-vless-reality-vision}"
SERVER_ADDR="${SERVER_ADDR:-}"

REALITY_SNI="${REALITY_SNI:-www.microsoft.com}"
REALITY_TARGET="${REALITY_TARGET:-${REALITY_SNI}:443}"
REALITY_PRIVATE_KEY="${REALITY_PRIVATE_KEY:-}"
REALITY_PUBLIC_KEY="${REALITY_PUBLIC_KEY:-}"
REALITY_SHORT_ID="${REALITY_SHORT_ID:-}"
UTLS_FINGERPRINT="${UTLS_FINGERPRINT:-chrome}"
SPIDER_X="${SPIDER_X:-/}"

FIRST_USER="${FIRST_USER:-user1}"
EXPIRE_DAYS="${EXPIRE_DAYS:-30}"
TOTAL_GB="${TOTAL_GB:-0}"
LIMIT_IP="${LIMIT_IP:-0}"
USERS="${USERS:-}"

AUTO_CREATE_INBOUND="${AUTO_CREATE_INBOUND:-1}"
ENABLE_BBR="${ENABLE_BBR:-1}"
OPEN_FIREWALL="${OPEN_FIREWALL:-1}"
FORCE_REINSTALL="${FORCE_REINSTALL:-0}"
ALLOW_USED_INBOUND_PORT="${ALLOW_USED_INBOUND_PORT:-0}"
DISK_MIN_MB="${DISK_MIN_MB:-1024}"
INSTALL_TMP=""

red='\033[0;31m'
green='\033[0;32m'
yellow='\033[0;33m'
plain='\033[0m'

usage() {
  cat <<'EOF'
用法:
  sudo bash install-vless-reality-3xui.sh [options]

参数:
  --panel-port PORT       Web 面板端口。默认随机高位端口
  --panel-user USER       Web 面板用户名。默认随机 admin_xxxxxx
  --panel-pass PASS       Web 面板密码。默认随机 18 位
  --panel-path PATH       Web 面板安全路径。默认随机 18 位
  --inbound-port PORT     VLESS REALITY 节点端口。默认 443
  --server-addr HOST      生成客户端链接时使用的服务器地址。默认自动获取公网 IP
  --sni DOMAIN            REALITY serverName/SNI。默认 www.microsoft.com
  --target HOST:PORT      REALITY 回落目标。默认 SNI:443
  --users SPEC            用户列表: 用户名:到期天数:流量GB:IP限制,用户2:到期天数:流量GB:IP限制
                           到期天数=0 表示永不过期，流量GB=0 表示不限流量
  --no-inbound            只安装面板，不自动创建节点
  --no-bbr                不开启 BBR sysctl
  --no-firewall           不自动放行 ufw/firewalld 端口
  --force-reinstall       替换已有的 /usr/local/x-ui
  --disk-min-mb MB        安装前要求的最小可用空间。默认 1024 MB
  -h, --help              显示帮助

示例:
  sudo bash install-vless-reality-3xui.sh
  sudo env USERS='alice:30:100:2,bob:7:0:0' bash install-vless-reality-3xui.sh
  sudo env PANEL_PORT=25443 INBOUND_PORT=443 EXPIRE_DAYS=90 bash install-vless-reality-3xui.sh
  sudo env DISK_MIN_MB=512 TMPDIR=/root bash install-vless-reality-3xui.sh
EOF
}

log() {
  echo -e "${green}[完成]${plain} $*"
}

warn() {
  echo -e "${yellow}[警告]${plain} $*"
}

die() {
  echo -e "${red}[错误]${plain} $*" >&2
  exit 1
}

cleanup_install_tmp() {
  if [[ -n "${INSTALL_TMP:-}" && -d "${INSTALL_TMP}" ]]; then
    rm -rf "${INSTALL_TMP}"
  fi
}

trap cleanup_install_tmp EXIT

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --panel-port) PANEL_PORT="$2"; shift 2 ;;
      --panel-user) PANEL_USER="$2"; shift 2 ;;
      --panel-pass) PANEL_PASS="$2"; shift 2 ;;
      --panel-path) PANEL_PATH="$2"; shift 2 ;;
      --inbound-port) INBOUND_PORT="$2"; shift 2 ;;
      --server-addr) SERVER_ADDR="$2"; shift 2 ;;
      --sni) REALITY_SNI="$2"; shift 2 ;;
      --target) REALITY_TARGET="$2"; shift 2 ;;
      --users) USERS="$2"; shift 2 ;;
      --no-inbound) AUTO_CREATE_INBOUND=0; shift ;;
      --no-bbr) ENABLE_BBR=0; shift ;;
      --no-firewall) OPEN_FIREWALL=0; shift ;;
      --force-reinstall) FORCE_REINSTALL=1; shift ;;
      --disk-min-mb) DISK_MIN_MB="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "未知参数: $1" ;;
    esac
  done
}

require_root() {
  [[ "${EUID}" -eq 0 ]] || die "请使用 root 权限运行，例如: sudo bash $0"
}

require_systemd() {
  command -v systemctl >/dev/null 2>&1 || die "当前脚本需要运行在 systemd Linux VPS 上。"
}

available_mb() {
  local path="$1"
  df -Pm "${path}" 2>/dev/null | awk 'NR==2 {print $4}'
}

require_space() {
  local path="$1" need_mb="$2" label="$3" free_mb
  free_mb="$(available_mb "${path}")"
  [[ -n "${free_mb}" ]] || die "无法检查 ${label} 的磁盘空间: ${path}"
  if (( free_mb < need_mb )); then
    die "${label} 可用空间不足：当前 ${free_mb} MB，至少需要 ${need_mb} MB。
请先在服务器执行 df -h 查看空间，必要时清理 /tmp、/var/cache/apt、旧日志或扩容磁盘后重试。"
  fi
}

choose_tmp_parent() {
  local candidate free_mb
  for candidate in "${TMPDIR:-}" /var/tmp /root /tmp; do
    [[ -n "${candidate}" && -d "${candidate}" && -w "${candidate}" ]] || continue
    free_mb="$(available_mb "${candidate}")"
    [[ -n "${free_mb}" ]] || continue
    if (( free_mb >= DISK_MIN_MB )); then
      echo "${candidate}"
      return
    fi
  done
  die "没有找到可用空间大于 ${DISK_MIN_MB} MB 的临时目录。可清理磁盘后重试，或指定 TMPDIR=/空间充足的目录。"
}

preflight_disk_space() {
  [[ "${DISK_MIN_MB}" =~ ^[0-9]+$ ]] || die "DISK_MIN_MB 必须是数字，当前值: ${DISK_MIN_MB}"
  require_space "/" "${DISK_MIN_MB}" "根分区"
  if [[ -d /usr/local ]]; then
    require_space "/usr/local" "${DISK_MIN_MB}" "/usr/local"
  fi
}

valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( $1 >= 1 && $1 <= 65535 ))
}

random_alnum() {
  local length="$1"
  local result chunk
  result=""
  while (( ${#result} < length )); do
    chunk="$(openssl rand -base64 $((length * 2)) | tr -dc 'a-zA-Z0-9')"
    result="${result}${chunk}"
  done
  printf '%s' "${result:0:length}"
}

random_hex() {
  local bytes="$1"
  openssl rand -hex "${bytes}"
}

random_port() {
  local n
  n=$(( 20000 + 0x$(openssl rand -hex 2) % 40000 ))
  echo "${n}"
}

is_port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :${port} )" 2>/dev/null | tail -n +2 | grep -q .
    return
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -lnt 2>/dev/null | awk -v p=":${port}" '$4 ~ p {found=1} END {exit !found}'
    return
  fi
  return 1
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|x64|amd64) echo "amd64" ;;
    i386|i686|x86) echo "386" ;;
    armv8*|aarch64|arm64) echo "arm64" ;;
    armv7*|armv7l) echo "armv7" ;;
    armv6*|armv6l) echo "armv6" ;;
    armv5*|armv5l) echo "armv5" ;;
    s390x) echo "s390x" ;;
    *) die "不支持的 CPU 架构: $(uname -m)" ;;
  esac
}

select_service_file() {
  local extracted_dir="$1"
  if [[ -f "${extracted_dir}/x-ui.service" ]]; then
    echo "${extracted_dir}/x-ui.service"
    return
  fi
  if command -v apt-get >/dev/null 2>&1 && [[ -f "${extracted_dir}/x-ui.service.debian" ]]; then
    echo "${extracted_dir}/x-ui.service.debian"
    return
  fi
  if { command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; } && [[ -f "${extracted_dir}/x-ui.service.rhel" ]]; then
    echo "${extracted_dir}/x-ui.service.rhel"
    return
  fi
  if command -v pacman >/dev/null 2>&1 && [[ -f "${extracted_dir}/x-ui.service.arch" ]]; then
    echo "${extracted_dir}/x-ui.service.arch"
    return
  fi
  find "${extracted_dir}" -maxdepth 1 -type f -name 'x-ui.service*' | sort | head -n 1
}

install_packages() {
  log "正在安装依赖组件"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y curl tar openssl ca-certificates jq cron tzdata socat iproute2
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y curl tar openssl ca-certificates jq cronie tzdata socat iproute
  elif command -v yum >/dev/null 2>&1; then
    yum install -y curl tar openssl ca-certificates jq cronie tzdata socat iproute
  elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm curl tar openssl ca-certificates jq cronie tzdata socat iproute2
  else
    die "不支持当前包管理器。请先手动安装 curl、tar、openssl、ca-certificates、jq、socat。"
  fi
}

set_defaults() {
  [[ -n "${PANEL_USER}" ]] || PANEL_USER="admin_$(random_alnum 6)"
  [[ -n "${PANEL_PASS}" ]] || PANEL_PASS="$(random_alnum 18)"
  [[ -n "${PANEL_PORT}" ]] || PANEL_PORT="$(random_port)"
  [[ -n "${PANEL_PATH}" ]] || PANEL_PATH="$(random_alnum 18)"
  PANEL_PATH="${PANEL_PATH#/}"
  PANEL_PATH="${PANEL_PATH%/}"
  [[ -n "${PANEL_PATH}" ]] || PANEL_PATH="$(random_alnum 18)"

  valid_port "${PANEL_PORT}" || die "面板端口无效 PANEL_PORT: ${PANEL_PORT}"
  valid_port "${INBOUND_PORT}" || die "节点端口无效 INBOUND_PORT: ${INBOUND_PORT}"
  [[ "${PANEL_PORT}" != "${INBOUND_PORT}" ]] || die "面板端口和节点端口不能相同。"

  if [[ -z "${USERS}" ]]; then
    USERS="${FIRST_USER}:${EXPIRE_DAYS}:${TOTAL_GB}:${LIMIT_IP}"
  fi
}

public_addr() {
  local ip
  ip="$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  [[ -n "${ip}" ]] || ip="$(curl -fsS4 --max-time 5 https://ifconfig.me 2>/dev/null || true)"
  [[ -n "${ip}" ]] || ip="YOUR_SERVER_IP"
  echo "${ip}"
}

install_3xui() {
  if [[ -x "${XUI_BIN}" && "${FORCE_REINSTALL}" != "1" ]]; then
    warn "检测到已安装 3x-ui: ${XUI_DIR}，本次会复用它。如需覆盖安装，请设置 FORCE_REINSTALL=1。"
    return
  fi

  local arch tmp_parent tmp pkg service_file
  arch="$(detect_arch)"
  tmp_parent="$(choose_tmp_parent)"
  tmp="$(TMPDIR="${tmp_parent}" mktemp -d)"
  INSTALL_TMP="${tmp}"
  pkg="${tmp}/x-ui-linux-${arch}.tar.gz"

  log "临时目录: ${tmp}，最低空间要求: ${DISK_MIN_MB} MB"
  log "正在下载适用于 ${arch} 的最新版 3x-ui"
  curl -fL --retry 3 -o "${pkg}" "https://github.com/MHSanaei/3x-ui/releases/latest/download/x-ui-linux-${arch}.tar.gz"

  if systemctl list-unit-files | grep -q '^x-ui\.service'; then
    systemctl stop x-ui >/dev/null 2>&1 || true
  fi

  if [[ -d "${XUI_DIR}" ]]; then
    local backup="/usr/local/x-ui.backup.$(date +%Y%m%d%H%M%S)"
    warn "正在备份已有 ${XUI_DIR} 到 ${backup}"
    mv "${XUI_DIR}" "${backup}"
  fi

  tar -xzf "${pkg}" -C "${tmp}"
  [[ -d "${tmp}/x-ui" ]] || die "3x-ui 发布包结构异常，无法继续安装。"
  service_file="$(select_service_file "${tmp}/x-ui")"
  [[ -n "${service_file}" && -f "${service_file}" ]] || die "未在 3x-ui 发布包中找到 systemd service 文件。"

  chmod +x "${tmp}/x-ui/x-ui" "${tmp}"/x-ui/bin/xray-linux-* "${tmp}/x-ui/x-ui.sh"
  cp -f "${tmp}/x-ui/x-ui.sh" /usr/bin/x-ui
  chmod +x /usr/bin/x-ui
  cp -f "${service_file}" "${XUI_SERVICE_FILE}"
  mv "${tmp}/x-ui" "${XUI_DIR}"

  systemctl daemon-reload
  systemctl enable x-ui >/dev/null
  cleanup_install_tmp
  INSTALL_TMP=""
  log "3x-ui 已安装"
}

configure_panel() {
  log "正在配置面板账号、端口和安全路径"
  "${XUI_BIN}" setting \
    -username "${PANEL_USER}" \
    -password "${PANEL_PASS}" \
    -port "${PANEL_PORT}" \
    -webBasePath "${PANEL_PATH}" >/dev/null

  systemctl restart x-ui

  local i
  for i in {1..30}; do
    if curl -fsS --max-time 2 "http://127.0.0.1:${PANEL_PORT}/${PANEL_PATH}/" >/dev/null 2>&1; then
      log "面板已启动"
      return
    fi
    sleep 1
  done
  systemctl status x-ui --no-pager -l || true
  die "3x-ui 面板未能在 127.0.0.1:${PANEL_PORT} 正常访问。"
}

enable_bbr() {
  [[ "${ENABLE_BBR}" == "1" ]] || return
  log "正在尝试开启 BBR"
  cat >/etc/sysctl.d/99-3xui-bbr.conf <<'EOF'
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF
  sysctl --system >/dev/null 2>&1 || warn "sysctl 重新加载时出现警告，继续执行。"
}

open_firewall() {
  [[ "${OPEN_FIREWALL}" == "1" ]] || return
  log "正在检查 ufw/firewalld，并尝试放行面板端口和节点端口"
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi active; then
    ufw allow "${PANEL_PORT}/tcp" >/dev/null || true
    ufw allow "${INBOUND_PORT}/tcp" >/dev/null || true
  fi
  if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port="${PANEL_PORT}/tcp" >/dev/null || true
    firewall-cmd --permanent --add-port="${INBOUND_PORT}/tcp" >/dev/null || true
    firewall-cmd --reload >/dev/null || true
  fi
}

find_xray_bin() {
  find "${XUI_DIR}/bin" -maxdepth 1 -type f -name 'xray-linux-*' -perm -111 | head -n 1
}

generate_reality_keys() {
  [[ -n "${REALITY_SHORT_ID}" ]] || REALITY_SHORT_ID="$(random_hex 8)"

  if [[ -n "${REALITY_PRIVATE_KEY}" && -n "${REALITY_PUBLIC_KEY}" ]]; then
    return
  fi

  local xray_bin keys
  xray_bin="$(find_xray_bin)"
  [[ -n "${xray_bin}" ]] || die "未在 ${XUI_DIR}/bin 下找到内置 xray 程序。"

  keys="$("${xray_bin}" x25519)"
  REALITY_PRIVATE_KEY="$(awk -F': ' 'tolower($1) ~ /private key/ {print $2; exit}' <<<"${keys}" | tr -d '[:space:]')"
  REALITY_PUBLIC_KEY="$(awk -F': ' 'tolower($1) ~ /public key/ {print $2; exit}' <<<"${keys}" | tr -d '[:space:]')"

  [[ -n "${REALITY_PRIVATE_KEY}" && -n "${REALITY_PUBLIC_KEY}" ]] || die "生成 REALITY x25519 密钥失败。"
}

gen_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr 'A-F' 'a-f'
  elif [[ -r /proc/sys/kernel/random/uuid ]]; then
    cat /proc/sys/kernel/random/uuid
  else
    local h
    h="$(random_hex 16)"
    echo "${h:0:8}-${h:8:4}-${h:12:4}-${h:16:4}-${h:20:12}"
  fi
}

expiry_ms() {
  local days="$1"
  [[ "${days}" =~ ^[0-9]+$ ]] || die "到期天数无效: ${days}"
  if [[ "${days}" == "0" ]]; then
    echo 0
  else
    echo $(( ( $(date +%s) + days * 86400 ) * 1000 ))
  fi
}

gb_to_bytes() {
  local gb="$1"
  [[ "${gb}" =~ ^[0-9]+$ ]] || die "流量 GB 数值无效: ${gb}"
  echo $(( gb * 1024 * 1024 * 1024 ))
}

urlencode() {
  jq -nr --arg v "$1" '$v|@uri'
}

panel_login() {
  local base="$1" cookie="$2" html csrf response
  html="$(curl -fsS -c "${cookie}" "${base}")"
  csrf="$(printf '%s' "${html}" | sed -n 's/.*<meta name="csrf-token" content="\([^"]*\)".*/\1/p' | head -n 1)"
  [[ -n "${csrf}" ]] || die "无法从面板登录页读取 CSRF token。"

  response="$(
    curl -fsS -b "${cookie}" -c "${cookie}" \
      -H "X-CSRF-Token: ${csrf}" \
      -H "X-Requested-With: XMLHttpRequest" \
      -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" \
      --data-urlencode "username=${PANEL_USER}" \
      --data-urlencode "password=${PANEL_PASS}" \
      "${base}login"
  )"
  echo "${response}" | jq -e '.success == true' >/dev/null || die "面板登录失败: ${response}"
  echo "${csrf}"
}

create_inbound() {
  [[ "${AUTO_CREATE_INBOUND}" == "1" ]] || return

  if is_port_in_use "${INBOUND_PORT}" && [[ "${ALLOW_USED_INBOUND_PORT}" != "1" ]]; then
    die "节点端口 ${INBOUND_PORT} 已被占用。请设置 INBOUND_PORT=8443，或设置 ALLOW_USED_INBOUND_PORT=1 后重试。"
  fi

  generate_reality_keys
  [[ -n "${SERVER_ADDR}" ]] || SERVER_ADDR="$(public_addr)"

  local clients_json links_json user_specs spec email days gb limit uuid sub_id exp total client link remark exp_text
  clients_json='[]'
  links_json='[]'

  IFS=',' read -r -a user_specs <<< "${USERS}"
  for spec in "${user_specs[@]}"; do
    IFS=':' read -r email days gb limit <<< "${spec}"
    email="${email:-}"
    days="${days:-${EXPIRE_DAYS}}"
    gb="${gb:-${TOTAL_GB}}"
    limit="${limit:-${LIMIT_IP}}"
    [[ -n "${email}" ]] || die "USERS 条目无效: ${spec}"
    [[ "${limit}" =~ ^[0-9]+$ ]] || die "USERS 条目里的 IP 限制无效: ${spec}"

    uuid="$(gen_uuid)"
    sub_id="$(random_alnum 16)"
    exp="$(expiry_ms "${days}")"
    total="$(gb_to_bytes "${gb}")"

    client="$(
      jq -cn \
        --arg id "${uuid}" \
        --arg email "${email}" \
        --arg subId "${sub_id}" \
        --argjson limitIp "${limit}" \
        --argjson totalGB "${total}" \
        --argjson expiryTime "${exp}" \
        '{id:$id,flow:"xtls-rprx-vision",email:$email,limitIp:$limitIp,totalGB:$totalGB,expiryTime:$expiryTime,enable:true,tgId:0,subId:$subId,comment:"",reset:0}'
    )"
    clients_json="$(jq -c --argjson client "${client}" '. + [$client]' <<< "${clients_json}")"

    remark="$(urlencode "${email}")"
    link="vless://${uuid}@${SERVER_ADDR}:${INBOUND_PORT}?type=tcp&security=reality&pbk=${REALITY_PUBLIC_KEY}&fp=${UTLS_FINGERPRINT}&sni=${REALITY_SNI}&sid=${REALITY_SHORT_ID}&spx=%2F&flow=xtls-rprx-vision#${remark}"
    if [[ "${exp}" == "0" ]]; then
      exp_text="never"
    else
      exp_text="$(date -d "@$(( exp / 1000 ))" '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null || echo "${days} 天后")"
    fi
    links_json="$(jq -c --arg email "${email}" --arg uuid "${uuid}" --arg link "${link}" --arg expiry "${exp_text}" '. + [{email:$email, uuid:$uuid, expiry:$expiry, link:$link}]' <<< "${links_json}")"
  done

  local settings stream sniffing base cookie csrf add_response inbound_id
  settings="$(jq -cn --argjson clients "${clients_json}" '{clients:$clients,decryption:"none",fallbacks:[]}')"
  stream="$(
    jq -cn \
      --arg target "${REALITY_TARGET}" \
      --arg sni "${REALITY_SNI}" \
      --arg privateKey "${REALITY_PRIVATE_KEY}" \
      --arg publicKey "${REALITY_PUBLIC_KEY}" \
      --arg sid "${REALITY_SHORT_ID}" \
      --arg fp "${UTLS_FINGERPRINT}" \
      --arg spx "${SPIDER_X}" \
      '{
        network:"tcp",
        security:"reality",
        externalProxy:[],
        realitySettings:{
          show:false,
          xver:0,
          target:$target,
          serverNames:[$sni],
          privateKey:$privateKey,
          minClientVer:"",
          maxClientVer:"",
          maxTimeDiff:0,
          maxTimediff:0,
          shortIds:[$sid],
          mldsa65Seed:"",
          settings:{publicKey:$publicKey,fingerprint:$fp,serverName:$sni,spiderX:$spx,mldsa65Verify:""}
        },
        tcpSettings:{acceptProxyProtocol:false,header:{type:"none"}},
        sockopt:{acceptProxyProtocol:false,tcpFastOpen:false,tproxy:"off"}
      }'
  )"
  sniffing='{"enabled":true,"destOverride":["http","tls","quic"],"metadataOnly":false,"routeOnly":false}'

  base="http://127.0.0.1:${PANEL_PORT}/${PANEL_PATH}/"
  cookie="$(mktemp)"
  trap 'rm -f "${cookie}"' RETURN
  csrf="$(panel_login "${base}" "${cookie}")"

  log "正在创建 VLESS REALITY Vision 节点，端口 ${INBOUND_PORT}"
  add_response="$(
    curl -fsS -b "${cookie}" -c "${cookie}" \
      -H "X-CSRF-Token: ${csrf}" \
      -H "X-Requested-With: XMLHttpRequest" \
      -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" \
      --data-urlencode "up=0" \
      --data-urlencode "down=0" \
      --data-urlencode "total=0" \
      --data-urlencode "remark=${INBOUND_REMARK}" \
      --data-urlencode "enable=true" \
      --data-urlencode "expiryTime=0" \
      --data-urlencode "listen=" \
      --data-urlencode "port=${INBOUND_PORT}" \
      --data-urlencode "protocol=vless" \
      --data-urlencode "settings=${settings}" \
      --data-urlencode "streamSettings=${stream}" \
      --data-urlencode "sniffing=${sniffing}" \
      "http://127.0.0.1:${PANEL_PORT}/${PANEL_PATH}/panel/api/inbounds/add"
  )"
  echo "${add_response}" | jq -e '.success == true' >/dev/null || die "创建节点失败: ${add_response}"
  inbound_id="$(echo "${add_response}" | jq -r '.obj.id // empty')"

  systemctl restart x-ui
  write_result "${links_json}" "${inbound_id}"
}

write_result() {
  local links_json="$1" inbound_id="${2:-}" result_file
  result_file="/root/3x-ui-reality-install-$(date +%Y%m%d%H%M%S).txt"

  {
    echo "3x-ui VLESS REALITY Vision 安装结果"
    echo "生成时间: $(date)"
    echo
    echo "面板地址: http://${SERVER_ADDR}:${PANEL_PORT}/${PANEL_PATH}/"
    echo "面板本地地址: http://127.0.0.1:${PANEL_PORT}/${PANEL_PATH}/"
    echo "面板用户名: ${PANEL_USER}"
    echo "面板密码: ${PANEL_PASS}"
    echo
    echo "节点 ID: ${inbound_id:-未知}"
    echo "节点端口: ${INBOUND_PORT}"
    echo "协议: VLESS + TCP + REALITY + Vision"
    echo "uTLS 指纹: ${UTLS_FINGERPRINT}"
    echo "REALITY 回落目标: ${REALITY_TARGET}"
    echo "REALITY SNI: ${REALITY_SNI}"
    echo "REALITY 公钥: ${REALITY_PUBLIC_KEY}"
    echo "REALITY short ID: ${REALITY_SHORT_ID}"
    echo
    echo "客户端链接:"
    jq -r '.[] | "- " + .email + " | 到期: " + .expiry + "\n  " + .link' <<< "${links_json}"
  } > "${result_file}"
  chmod 600 "${result_file}"

  echo
  echo "============================================================"
  echo "面板地址: http://${SERVER_ADDR}:${PANEL_PORT}/${PANEL_PATH}/"
  echo "用户名: ${PANEL_USER}"
  echo "密码: ${PANEL_PASS}"
  echo "结果文件: ${result_file}"
  echo "============================================================"
  echo
  jq -r '.[] | "用户: " + .email + " | 到期: " + .expiry + "\n" + .link + "\n"' <<< "${links_json}"
}

main() {
  parse_args "$@"
  require_root
  require_systemd
  preflight_disk_space
  install_packages
  set_defaults
  install_3xui
  configure_panel
  enable_bbr
  open_firewall
  create_inbound

  if [[ "${AUTO_CREATE_INBOUND}" != "1" ]]; then
    [[ -n "${SERVER_ADDR}" ]] || SERVER_ADDR="$(public_addr)"
    echo
    echo "面板地址: http://${SERVER_ADDR}:${PANEL_PORT}/${PANEL_PATH}/"
    echo "用户名: ${PANEL_USER}"
    echo "密码: ${PANEL_PASS}"
  fi
}

main "$@"
