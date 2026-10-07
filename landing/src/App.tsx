import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Layers3,
  MessageCircle,
  Monitor,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Waves,
  X,
} from "lucide-react";
import { release } from "./releases";
import { useMotion } from "./useMotion";

type Modal = "install" | "qr" | "chat" | "calendar" | "delivery" | null;
const steps = [
  {
    label: "说出想法",
    title: "从还没想清楚的地方开始。",
    copy: "不用先写一份完美的计划。想做的事、纠结的事，都可以先告诉小汐。",
  },
  {
    label: "理清目标",
    title: "把确定与不确定，分开来看。",
    copy: "目标逐渐清晰；还缺少的信息留在对话里继续讨论，不急着替你做决定。",
  },
  {
    label: "确认行动",
    title: "下一步，不必很大。",
    copy: "看清将要创建的事项，微调时间与优先级，确认后再进入任务和日历。",
  },
];

function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previous;
      prior?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={close}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const stops = [
          ...e.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],[tabindex="0"]',
          ),
        ].filter((el) => el.getClientRects().length);
        const first = stops[0],
          last = stops[stops.length - 1];
        if (!first) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="dialog-inner">
        <header className="dialog-header">
          <h2 id="dialog-title">{title}</h2>
          <button
            type="button"
            className="icon-button"
            title="关闭"
            aria-label="关闭"
            onClick={close}
          >
            <X size={22} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

function CopyHash({ value, label }: { value: string; label: string }) {
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("已复制 SHA-256");
    } catch {
      setMessage("无法访问剪贴板，请选择校验值复制。");
    }
  }
  return (
    <div className="hash-row">
      <code>{value}</code>
      <button
        className="icon-button"
        aria-label={`复制${label}校验值`}
        title="复制 SHA-256"
        onClick={() => void copy()}
      >
        <Copy size={17} />
      </button>
      <span className="copy-status" role="status">
        {message}
      </span>
    </div>
  );
}

function Health() {
  const [state, setState] = useState<"idle" | "loading" | "healthy" | "error">(
    "idle",
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    setState("loading");
    void fetch("/health", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || (await response.text()).trim() !== "ok")
          throw Error("health");
        if (active) setState("healthy");
      })
      .catch(() => {
        if (active) setState("error");
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);
  return (
    <div className="health">
      <span className={`status-dot ${state}`} />
      <span role="status">
        {state === "idle"
          ? "服务状态尚未检查"
          : state === "loading"
            ? "正在检查服务"
            : state === "healthy"
              ? "健康端点可达"
              : "暂时无法连接服务"}
      </span>
      <button
        className="icon-button"
        disabled={state === "loading"}
        onClick={() => setAttempt((x) => x + 1)}
        aria-label="重新检查服务"
        title="重新检查服务"
      >
        <RefreshCw size={15} />
      </button>
    </div>
  );
}

function Privacy() {
  return (
    <main id="main" className="privacy wrap">
      <a className="text-link" href="/">
        <ArrowRight size={18} className="back-arrow" />
        返回下载页
      </a>
      <span className="eyebrow">DATA & PRIVACY · 内测说明</span>
      <h1>你的资料，先留在你身边。</h1>
      <p className="lede">
        Oceanseo {release.version} 数据与隐私说明 · 更新于 2026-10-05
      </p>
      <section>
        <h2>本机记录与备份</h2>
        <p>
          任务、笔记、人物、训练、旅行与其他已提交业务记录保存在设备本机。服务密钥单独保存；Android
          使用 Keystore 加密密钥，但不是整个数据库加密。应用内 JSON
          备份包含私人资料，应妥善保存；服务密钥和未提交草稿不在备份范围内。卸载或清除
          Android 应用数据前，请先导出备份。
        </p>
      </section>
      <section>
        <h2>AI 与地图服务</h2>
        <p>
          AI 默认需要你在设置中填写自己的 API_KEY、BASE_URL
          和模型，可能产生第三方费用。主动使用 AI
          时，对话、所选上下文及相应规划条件发送给你配置的服务商；发送前可检查上下文。照片提炼会发送你选择的图片。地图搜索向地图服务发送查询，底图服务会接收查看区域与网络地址。服务商的数据留存由其政策决定。
        </p>
      </section>
      <section>
        <h2>跨设备同步</h2>
        <p>
          本页公开的 {release.version} 包仍使用默认关闭的个人同步：配置自己的服务器和独立令牌后，先检查更改，再确认上传与合并。维护者私人资料库不向下载用户发放共享令牌。
        </p>
        <p>
          新的邀请制账号客户端尚未替换本页下载包。获邀用户登录后使用独立账号资料库，默认在应用前台自动同步，可主动关闭；本机旧资料不会自动导入。两个版本的同步范围均为任务、笔记、目标、已保存对话与执行记录，生活模块、服务密钥和未提交草稿不参与。同步不是端到端加密，服务器管理员和反向代理提供方可能读取资料。
        </p>
      </section>
      <section>
        <h2>下载网站与日志</h2>
        <p>
          本站不使用广告、分析 SDK、登录追踪或第三方字体。静态页面和下载经
          Cloudflare 与源站提供；服务设施可能处理访问
          IP、请求路径、时间等必要日志。页面打开后仅请求公开健康端点，不上传应用记录，不访问私人采集数据。
        </p>
      </section>
      <section>
        <h2>通知、文件与删除</h2>
        <p>
          通知授权由你决定；Android
          每日提醒正文不包含任务详情，系统省电可能延迟提醒。文件仅在主动导入、备份、导出或分享时处理。删除本机记录不自动删除导出文件、第三方日志或云端备份。人物归档不等于删除个人信息，需使用档案中的清除功能；彻底清理同步资料需协调服务器资料库及备份。
        </p>
      </section>
      <section>
        <h2>当前发行边界与反馈</h2>
        <p>
          本页下载的是 ARM64 Android 9+ 内测包，使用调试签名，并非商店正式版；Linux
          包面向 Debian / Ubuntu / Linux Mint 的 amd64 设备。暂无 iOS
          版本、公开注册、官方 AI
          额度或崩溃自动上报。邀请制账号可在“我的账号”中输入当前密码和
          DELETE 确认词删除云端账号；本机资料会保留为离线副本。忘记密码仍需通过邀请渠道联系维护者，正式发布前仍需补充发行主体与支持联系方式；反馈时请遮盖密钥和私人资料。
        </p>
      </section>
    </main>
  );
}

export default function App({ privacy = false }: { privacy?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [floatingDownload, setFloatingDownload] = useState(false);
  useEffect(() => {
    if (privacy || typeof IntersectionObserver === "undefined") return;
    const visibility = new Map<Element, boolean>();
    const buttons = document.querySelectorAll(
      ".hero-actions .primary,.download-apk",
    );
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) =>
        visibility.set(entry.target, entry.isIntersecting),
      );
      setFloatingDownload(![...visibility.values()].some(Boolean));
    });
    buttons.forEach((button) => {
      visibility.set(button, true);
      observer.observe(button);
    });
    return () => observer.disconnect();
  }, [privacy]);
  useMotion(root);
  return (
    <div ref={root}>
      <a className="skip-link" href="#main">
        跳转到主要内容
      </a>
      <header className="site-header">
        <div className="wrap header-inner">
          <a className="brand" href="/" aria-label="Oceanseo 首页">
            <img src="/media/mascot.webp" alt="" width="36" height="36" />
            <span>
              oceanseo<span className="brand-dot">.</span>
            </span>
          </a>
          <nav aria-label="网站导航">
            <a
              className="desktop-link"
              href={privacy ? "/#experience" : "#experience"}
            >
              认识小汐
            </a>
            <a
              className="nav-download"
              href={privacy ? "/#download" : "#download"}
            >
              获取内测版
              <ArrowDown size={16} />
            </a>
          </nav>
        </div>
      </header>
      {privacy ? (
        <Privacy />
      ) : (
        <main id="main">
          <section className="hero" aria-labelledby="hero-title">
            <picture className="hero-media">
              <source
                media="(max-width: 600px)"
                srcSet="/media/hero-mobile.webp"
              />
              <img
                src="/media/hero-desktop.webp"
                alt="Oceanseo 当前内测版的对话、交付清单与日历界面，示例数据"
                fetchPriority="high"
              />
            </picture>
            <div className="hero-copy wrap">
              <div className="release-chip">
                <span className="status-dot healthy" />
                ANDROID 内测现已开放
                <span className="mono">v{release.version}</span>
              </div>
              <h1 id="hero-title">
                Oceanseo<span className="brand-dot">.</span>
              </h1>
              <p className="hero-subtitle">你的个人生活中枢</p>
              <p className="hero-description">
                把纷杂的想法，慢慢理成下一步。
                <br />
                与小汐一起，让计划回到自己的节奏。
              </p>
              <div className="hero-actions">
                <a className="button primary" href="#download">
                  <Download size={19} />
                  下载 Android 内测版
                </a>
                <a className="hero-explore" href="#experience">
                  看看如何开始
                  <ArrowRight size={17} />
                </a>
              </div>
            </div>
            <div className="hero-caption">
              <span>当前版本界面 · 示例记录</span>
              <a href="#experience" aria-label="继续浏览">
                <ArrowDown size={19} />
              </a>
              <span className="desktop-link">想法 / 目标 / 行动</span>
            </div>
          </section>

          <section id="experience" className="experience wrap section-space">
            <div className="section-heading" data-reveal>
              <div>
                <span className="eyebrow">WITH XIAOXI</span>
                <h2>不用把生活一次想明白。</h2>
              </div>
              <p>
                先说出来，再一起整理。
                <br />
                决定权，始终在你手里。
              </p>
            </div>
            <div className="experience-layout" data-reveal>
              <div className="experience-copy">
                <div className="tabs" role="tablist" aria-label="流程预览">
                  {steps.map((item, i) => (
                    <button
                      key={item.label}
                      role="tab"
                      id={`step-${i}`}
                      aria-selected={step === i}
                      aria-controls="step-panel"
                      tabIndex={step === i ? 0 : -1}
                      onClick={() => setStep(i)}
                      onKeyDown={(e) => {
                        if (
                          ["ArrowRight", "ArrowLeft", "Home", "End"].includes(
                            e.key,
                          )
                        ) {
                          e.preventDefault();
                          const next =
                            e.key === "Home"
                              ? 0
                              : e.key === "End"
                                ? 2
                                : (step + (e.key === "ArrowRight" ? 1 : 2)) % 3;
                          setStep(next);
                          document.getElementById(`step-${next}`)?.focus();
                        }
                      }}
                    >
                      <span className="mono">0{i + 1}</span>
                      {item.label}
                    </button>
                  ))}
                </div>
                <div
                  id="step-panel"
                  role="tabpanel"
                  aria-labelledby={`step-${step}`}
                  tabIndex={0}
                >
                  <h3>{steps[step].title}</h3>
                  <p>{steps[step].copy}</p>
                </div>
                <div className="companion">
                  <img
                    src="/media/mascot.webp"
                    alt="小汐，潮汐主题的刺猬伙伴"
                    loading="lazy"
                    width="86"
                    height="86"
                  />
                  <p>
                    <strong>小汐</strong>
                    <span>安静一点，陪你向前一点。</span>
                  </p>
                </div>
              </div>
              <div className="demo" aria-label="未来界面交互示例">
                <div className="demo-header">
                  <span>
                    <Waves size={18} />
                    与小汐一起
                  </span>
                  <small>交互方向预览 · 非在线 AI</small>
                </div>
                <div className="demo-body" key={step}>
                  {step === 0 && (
                    <>
                      <div className="message user-message">
                        最近事情有点乱。这周想完成项目发布，也想恢复运动，但不知道先做什么。
                      </div>
                      <div className="assistant-message">
                        <img
                          src="/media/mascot.webp"
                          alt=""
                          width="34"
                          height="34"
                        />
                        <div>
                          <strong>小汐</strong>
                          <p>
                            我们先把它们分开。项目发布有明确的截止时间吗？运动方面，你想从每周几次开始？
                          </p>
                          <span className="demo-note">
                            先补齐信息，不急着创建任务。
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                  {step === 1 && (
                    <>
                      <p className="demo-context">
                        “发布周五完成；先从每周两次运动开始。”
                      </p>
                      <div className="clarity-row">
                        <CheckCheck size={19} />
                        <div>
                          <strong>项目发布</strong>
                          <span>周五前完成 · 优先安排验证</span>
                        </div>
                        <span className="tag">已清晰</span>
                      </div>
                      <div className="clarity-row">
                        <CheckCheck size={19} />
                        <div>
                          <strong>恢复运动</strong>
                          <span>每周两次 · 先建立节奏</span>
                        </div>
                        <span className="tag">已清晰</span>
                      </div>
                      <div className="clarity-row unknown">
                        <MessageCircle size={19} />
                        <div>
                          <strong>具体训练内容</strong>
                          <span>还需要了解训练基础和可用时间</span>
                        </div>
                        <span className="tag">待补充</span>
                      </div>
                      <p className="demo-note">
                        不清楚的部分，回到对话中继续确认。
                      </p>
                    </>
                  )}
                  {step === 2 && (
                    <>
                      <p className="demo-context">
                        准备好之后，只确认你认可的行动。
                      </p>
                      <div className="action-preview">
                        <span className="check-box">
                          <Check size={16} />
                        </span>
                        <div>
                          <strong>完成发布前验证</strong>
                          <span>任务管理 / 本周四 / 高优先级</span>
                        </div>
                        <Layers3 size={19} />
                      </div>
                      <div className="action-preview">
                        <span className="check-box">
                          <Check size={16} />
                        </span>
                        <div>
                          <strong>安排第一次训练</strong>
                          <span>训练计划 / 时间待你确认</span>
                        </div>
                        <Layers3 size={19} />
                      </div>
                      <div className="demo-summary">
                        <span>2 项行动草案</span>
                        <span>
                          确认后加入任务与日历
                          <ArrowRight size={17} />
                        </span>
                      </div>
                      <p className="demo-note">
                        本站示例不会创建、保存或同步任何记录。
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="screens-band section-space">
            <div className="wrap">
              <div className="section-heading" data-reveal>
                <div>
                  <span className="eyebrow">IN YOUR POCKET</span>
                  <h2>把下一步，带在身边。</h2>
                </div>
                <p>
                  对话、清单、日历，接上同一件事。
                  <br />
                  以下为 {release.version} 当前界面，使用示例数据。
                </p>
              </div>
              <div className="screens">
                {(
                  [
                    {
                      key: "chat",
                      label: "想法与目标",
                      detail: "从一段对话开始",
                      image: "app-chat",
                    },
                    {
                      key: "delivery",
                      label: "确认交付清单",
                      detail: "执行前，看清每一项",
                      image: "app-delivery",
                    },
                    {
                      key: "calendar",
                      label: "计划日历",
                      detail: "把行动放回时间里",
                      image: "app-calendar",
                    },
                  ] as const
                ).map((screen, i) => (
                  <figure key={screen.key} data-reveal>
                    <button
                      className="screen-button"
                      aria-label={`放大${screen.label}截图`}
                      onClick={() => setModal(screen.key)}
                    >
                      <img
                        src={`/media/${screen.image}.webp`}
                        alt={`${release.version} ${screen.label}实际界面`}
                        width="390"
                        height="844"
                        loading="lazy"
                      />
                    </button>
                    <figcaption>
                      <span className="mono">0{i + 1}</span>
                      <div>
                        <strong>{screen.label}</strong>
                        <span>{screen.detail}</span>
                      </div>
                      <button
                        className="icon-button"
                        title="放大截图"
                        aria-label={`查看${screen.label}`}
                        onClick={() => setModal(screen.key)}
                      >
                        <ExternalLink size={17} />
                      </button>
                    </figcaption>
                  </figure>
                ))}
              </div>
              <div className="life-strip">
                <span>还有，日常生活里的那些事。</span>
                <p>
                  事项笔记<span>/</span>饮食采购<span>/</span>训练计划
                  <span>/</span>旅行规划<span>/</span>人物档案
                </p>
              </div>
            </div>
          </section>

          <section
            id="download"
            className="download-section wrap section-space"
          >
            <div className="section-heading" data-reveal>
              <div>
                <span className="eyebrow">START AT YOUR PACE</span>
                <h2>从这里，开始自己的节奏。</h2>
              </div>
              <p>
                无需注册。先在本机记录，
                <br />
                需要时，再连接自己的服务。
              </p>
            </div>
            <div className="download-layout">
              <div className="android-download">
                <div className="platform-title">
                  <Smartphone size={30} />
                  <div>
                    <h3>Android</h3>
                    <span className="mono">
                      v{release.version}-internal · {release.android.size}
                    </span>
                  </div>
                  <span className="tag beta">内测版</span>
                </div>
                <p>
                  Android 9 及以上 · ARM64 设备
                  <br />
                  安装后打开「Oceanseo · 内测」。更新前请先备份。
                </p>
                <a
                  className="button primary download-apk"
                  href={release.android.url}
                  download
                  onClick={(e) => {
                    e.preventDefault();
                    setModal("install");
                  }}
                >
                  <Download size={20} />
                  下载安装包
                  <ArrowRight size={18} />
                </a>
                <button className="qr-link" onClick={() => setModal("qr")}>
                  <QrCode size={18} />
                  在手机上打开
                </button>
                <div className="release-warning">
                  <ShieldCheck size={18} />
                  <span>
                    调试签名，仅供内测。更新或更换安装包前请导出备份；不兼容签名时不要直接卸载。
                  </span>
                </div>
                <details className="checksum">
                  <summary>核对 SHA-256 校验值</summary>
                  <CopyHash value={release.android.sha256} label="Android" />
                  <a href={`${release.android.url}.sha256`} download>
                    下载校验文件
                  </a>
                </details>
              </div>
              <div className="download-side">
                <div className="linux-download">
                  <div className="platform-title">
                    <Monitor size={26} />
                    <div>
                      <h3>Linux</h3>
                      <span className="mono">
                        v{release.version} · {release.linux.size}
                      </span>
                    </div>
                  </div>
                  <p>
                    Linux Mint / Ubuntu / Debian
                    <br />
                    amd64 · DEB 安装包
                  </p>
                  <a
                    className="button secondary"
                    href={release.linux.url}
                    download
                  >
                    <Download size={18} />
                    下载 Linux 版本
                  </a>
                  <details className="checksum">
                    <summary>核对 SHA-256 校验值</summary>
                    <CopyHash value={release.linux.sha256} label="Linux" />
                    <a href={`${release.linux.url}.sha256`} download>
                      下载校验文件
                    </a>
                  </details>
                </div>
                <div className="availability">
                  <span>其他平台</span>
                  <p>
                    iOS
                    暂未提供。手机拼豆工作台与工作观察未开放；相关完整工具请使用
                    Linux 版本。
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="faq-band">
            <div className="wrap faq-layout">
              <div>
                <span className="eyebrow">BEFORE YOU START</span>
                <h2>开始之前。</h2>
                <a className="text-link" href="/privacy/">
                  数据与隐私说明
                  <ArrowRight size={17} />
                </a>
              </div>
              <div className="faq">
                <details>
                  <summary>
                    如何安装 Android 内测版？
                    <ChevronRight size={19} />
                  </summary>
                  <p>
                    下载 APK
                    后打开文件，按系统提示仅允许当前浏览器或文件管理器“安装未知应用”。这是内测调试包，不需要
                    root。安装后打开「Oceanseo · 内测」；安全提示请仔细核实，不要忽略明确的风险告警。若提示签名冲突，先从原应用导出备份，再联系维护者确认迁移方式。
                  </p>
                </details>
                <details>
                  <summary>
                    AI 需要单独配置吗？
                    <ChevronRight size={19} />
                  </summary>
                  <p>
                    需要。在「设置 → AI 服务」填写自己的 API_KEY、BASE_URL
                    和模型。小汐、食谱和规划共用这份配置，所选服务需支持应用使用的结构化接口。下载不包含官方
                    AI 额度，第三方调用可能收费。
                  </p>
                </details>
                <details>
                  <summary>
                    电脑和手机会自动同步吗？
                    <ChevronRight size={19} />
                  </summary>
                  <p>
                    不会默认连接或自动上传。当前支持自托管的私人同步，需配置服务器与独立令牌，检查更改后确认合并；同步任务、笔记、目标和已保存对话，暂不含全部生活模块。本站不提供公共账号，不共享维护者的私人资料库。
                  </p>
                </details>
                <details>
                  <summary>
                    如何更新、备份和反馈？
                    <ChevronRight size={19} />
                  </summary>
                  <p>
                    更新前先在「设置 → 数据备份与恢复」导出
                    JSON；备份不包含服务密钥与未提交草稿。当前版本采用内部调试签名，正式版迁移安排尚未完成。问题请通过原内测沟通渠道反馈，注明系统和版本，并遮盖截图中的私人信息。
                  </p>
                </details>
              </div>
            </div>
          </section>
        </main>
      )}
      <footer className="site-footer wrap">
        <div>
          <a className="brand" href="/">
            oceanseo<span className="brand-dot">.</span>
          </a>
          <span>生活有自己的潮汐。</span>
        </div>
        <div className="footer-right">
          <Health />
          <a href="/privacy/">数据与隐私</a>
          <span className="mono">INTERNAL BETA · 2026</span>
        </div>
      </footer>
      {!privacy && (
        <a
          className={`mobile-download button primary${floatingDownload ? " is-visible" : ""}`}
          href="#download"
        >
          <Download size={18} />
          获取 Android 内测版<span className="mono">{release.version}</span>
        </a>
      )}
      {modal && (
        <Dialog
          title={
            modal === "install"
              ? "安装 Android 内测版"
              : modal === "qr"
                ? "在手机上打开"
                : "当前版本界面 · 示例记录"
          }
          close={() => setModal(null)}
        >
          {modal === "install" ? (
            <>
              <p>Oceanseo {release.version}-internal · Android 9+ · ARM64</p>
              <ol className="install-list">
                <li>
                  <strong>先保留你的记录</strong>
                  <p>
                    已有版本请先导出应用内 JSON 备份。签名冲突时不要直接卸载。
                  </p>
                </li>
                <li>
                  <strong>下载并打开 APK</strong>
                  <p>
                    按系统提示允许当前下载来源安装应用，安装后打开「Oceanseo · 内测」。
                  </p>
                </li>
                <li>
                  <strong>按需配置服务</strong>
                  <p>
                    本机记录不需要账号。AI
                    使用你自己的服务配置；私人同步默认关闭。
                  </p>
                </li>
              </ol>
              <a className="button primary" href={release.android.url} download>
                <Download size={19} />
                确认下载 · {release.android.size}
              </a>
              <a className="text-link privacy-link" href="/privacy/">
                查看数据与隐私说明
                <ArrowRight size={16} />
              </a>
            </>
          ) : modal === "qr" ? (
            <div className="qr-content">
              <img
                src="/media/download-qr.png"
                alt="二维码：打开 Oceanseo 下载页"
                width="256"
                height="256"
              />
              <p>用手机相机扫码打开下载页</p>
              <a
                className="text-link"
                href="https://oceanseo.gellaronline.cc/#download"
              >
                oceanseo.gellaronline.cc
                <ExternalLink size={16} />
              </a>
            </div>
          ) : (
            <img
              className="full-screen-image"
              src={`/media/app-${modal}.webp`}
              alt={`${release.version} 内测版真实界面，示例数据`}
              width="390"
              height="844"
            />
          )}
        </Dialog>
      )}
    </div>
  );
}
