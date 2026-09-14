import { variableKeys } from "../shared/templates";
import { WhatsAppFlows } from "./flows/WhatsAppFlows";
import { EmbeddedSignup } from "./EmbeddedSignup";
import { TemplateModal } from "./templates/TemplateModal";
import { SendTemplateModal } from "./templates/SendTemplateModal";
import { Audiences } from "./audiences/Audiences";
import { BulkTemplateSend } from "./audiences/BulkTemplateSend";
import { supportsAutomaticTemplate } from "../shared/template-send";
import { useEffect, useMemo, useState } from "react";
import "./auth.css";
import {
  Archive,
  Bell,
  Check,
  CheckCheck,
  FileText,
  Inbox,
  LayoutGrid,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Phone,
  Plus,
  Search,
  Send,
  Settings,
  Smile,
  Trash2,
  UserPlus,
  Users,
  LogOut,
  UserRound,
  Workflow,
  Pencil,
  Zap,
  X,
} from "lucide-react";
import {
  api,
  type ApiContact,
  type ApiConversation,
  type ApiMessage,
  type ApiTemplate,
  type WhatsAppHealth,
  type ApiAutomationFlow,
  type ApiAutomationTrigger,
  type ApiUser,
  type ApiAudience,
} from "./api";

export default function App() {
  const [user, setUser] = useState<ApiUser|null>(null), [checking, setChecking] = useState(true);
  useEffect(() => { if (!localStorage.getItem("relay_token")) { setChecking(false); return; } api.me().then(setUser).catch(() => localStorage.removeItem("relay_token")).finally(() => setChecking(false)); }, []);
  if (checking) return <div className="login-page"><div className="login-card">Loading Relay…</div></div>;
  if (!user) return <Login onLogin={setUser} />;
  return <Workspace user={user} logout={() => { localStorage.removeItem("relay_token"); setUser(null); }} />;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function Workspace({ user, logout }: { user: ApiUser; logout: () => void }) {
  const [tab, setTab] = useState<"inbox" | "templates" | "send-template" | "audiences" | "whatsapp-flows" | "contacts" | "agents" | "settings">("inbox"),
    [active, setActive] = useState(""),
    [draft, setDraft] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState<"all" | "unread" | "archived">("all");
  const [conversations, setConversations] = useState<ApiConversation[]>([]),
    [chatMessages, setChatMessages] = useState<ApiMessage[]>([]);
  const [templates, setTemplates] = useState<ApiTemplate[]>([]),
    [contacts, setContacts] = useState<ApiContact[]>([]),
    [audiences, setAudiences] = useState<ApiAudience[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false),
    [modal, setModal] = useState(false),
    [contactModal, setContactModal] = useState(false),
    [templateSend, setTemplateSend] = useState(false);
  const [flows, setFlows] = useState<ApiAutomationFlow[]>([]),
    [triggers, setTriggers] = useState<ApiAutomationTrigger[]>([]),
    [flowModal, setFlowModal] = useState<ApiAutomationFlow | true | null>(null),
    [triggerModal, setTriggerModal] = useState(false),
    [editingTemplate, setEditingTemplate] = useState<ApiTemplate | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsAppHealth | null>(null);
  const [agents, setAgents] = useState<ApiUser[]>([]), [agentModal, setAgentModal] = useState(false);
  useEffect(() => { api.agents().then(setAgents).catch(e => setError(e.message)); }, []);
  useEffect(() => {
    api
      .conversations(true)
      .then((data) => {
        setConversations(data);
        setActive(
          (current) =>
            current || (window.innerWidth > 720 ? data.find((c) => !c.archivedAt)?.id || "" : ""),
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!active) {
      setChatMessages([]);
      return;
    }
    api
      .messages(active)
      .then(setChatMessages)
      .catch((e) => setError(e.message));
    setConversations((current) =>
      current.map((c) => (c.id === active ? { ...c, unreadCount: 0 } : c)),
    );
    api.updateConversation(active, "read").catch((e) => setError(e.message));
  }, [active]);
  useEffect(() => {
    if (tab === "templates" || tab === "send-template" || templateSend)
      api
        .templates(true)
        .then((data) => {
          setTemplates(data);
          setError("");
        })
        .catch((e) => {
          setError(e.message);
          api
            .templates()
            .then(setTemplates)
            .catch(() => {});
        });
  }, [tab, templateSend]);
  useEffect(() => {
    if (["contacts", "audiences", "send-template"].includes(tab))
      Promise.all([api.contacts(), api.audiences()]).then(([contactData, audienceData]) => { setContacts(contactData); setAudiences(audienceData) }).catch((e) => setError(e.message));
  }, [tab]);
  useEffect(() => {
    api
      .whatsappHealth()
      .then(setWhatsapp)
      .catch((error) =>
        setWhatsapp({
          connected: false,
          error: error instanceof Error ? error.message : "Meta connection failed",
        }),
      );
  }, []);
  useEffect(() => {
    const events = new EventSource(`/api/events?token=${encodeURIComponent(localStorage.getItem("relay_token") || "")}`);
    const refresh = () => {
      api
        .conversations(true)
        .then((data) => {
          const selected = data.find((c) => c.id === active);
          if (selected?.unreadCount) api.updateConversation(active, "read").catch(() => {});
          setConversations(data.map((c) => (c.id === active ? { ...c, unreadCount: 0 } : c)));
        })
        .catch(() => {});
      if (active)
        api
          .messages(active)
          .then(setChatMessages)
          .catch(() => {});
    };
    const refreshTemplates = () => {
      if (tab === "templates" || tab === "send-template" || templateSend)
        api
          .templates()
          .then(setTemplates)
          .catch(() => {});
    };
    events.addEventListener("inbox", refresh);
    events.addEventListener("templates", refreshTemplates);
    return () => events.close();
  }, [active, tab, templateSend]);
  const unreadCount = conversations.reduce((sum, c) => sum + (Number(c.unreadCount) || 0), 0);
  const filtered = useMemo(
    () =>
      conversations.filter(
        (c) =>
          (filter === "archived" ? Boolean(c.archivedAt) : !c.archivedAt) &&
          (filter !== "unread" || (Number(c.unreadCount) || 0) > 0) &&
          (c.contact.profileName || c.contact.phone).toLowerCase().includes(search.toLowerCase()),
      ),
    [conversations, search, filter],
  );
  const conversation = conversations.find((c) => c.id === active);
  const canInteract = Boolean(conversation?.claimedBy && (conversation.claimedBy.id === user.id || conversation.assignee?.id === user.id));
  const send = async () => {
    if (!draft.trim() || !active || sending) return;
    const body = draft.trim();
    setSending(true);
    setError("");
    try {
      const message = await api.sendMessage(active, body);
      setChatMessages((m) => [...m, message]);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to send message");
    } finally {
      setSending(false);
    }
  };
  const changeConversation = async (
    id: string,
    action: "open" | "close" | "archive" | "unarchive",
  ) => {
    try {
      const updated = await api.updateConversation(id, action);
      setConversations((current) => current.map((c) => (c.id === id ? updated : c)));
      if (action === "archive") {
        setActive("");
        setFilter("all");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update conversation");
    }
  };
  return (
    <div className="app">
      <aside className="nav">
        <div className="logo" title="Relay WhatsApp inbox">
          <MessageCircle size={21} />
        </div>
        <nav>
          <button className={tab === "inbox" ? "on" : ""} onClick={() => setTab("inbox")}>
            <Inbox />
            <span>Inbox</span>
            <b>{unreadCount}</b>
          </button>
          <button className={tab === "templates" ? "on" : ""} onClick={() => setTab("templates")}>
            <FileText />
            <span>Templates</span>
          </button>
          <button className={tab === "send-template" ? "on" : ""} onClick={() => setTab("send-template")}><Send /><span>Send template</span></button>
          <button className={tab === "audiences" ? "on" : ""} onClick={() => setTab("audiences")}><Users /><span>Audiences</span></button>
          <button className={tab === "whatsapp-flows" ? "on" : ""} onClick={() => setTab("whatsapp-flows")}><Workflow /><span>WhatsApp Flows</span></button>
          <button className={tab === "contacts" ? "on" : ""} onClick={() => setTab("contacts")}>
            <LayoutGrid />
            <span>Contacts</span>
          </button>
          {user.role === "ADMIN" && <button className={tab === "agents" ? "on" : ""} onClick={() => setTab("agents")}><Users /><span>Agents</span></button>}
        </nav>
        <div className="nav-bottom">
          {user.role === "ADMIN" && <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
            <Settings />
            <span>Settings</span>
          </button>}
          <div className="reception">
            <span>
              <UserRound size={16} />
            </span>
            <div>
              <b>{user.name}</b>
              <small>{titleCase(user.role)}</small>
            </div>
            <button aria-label="Log out" title="Log out" onClick={logout}>
              <LogOut />
            </button>
          </div>
        </div>
      </aside>
      <section className="main">
        <header>
          <div>
            <h1>
              {tab === "inbox" ? "Inbox" : tab === "templates" ? "Message templates" : tab === "send-template" ? "Send template" : tab === "audiences" ? "Audiences" : tab === "whatsapp-flows" ? "WhatsApp Flows" : tab === "agents" ? "Team agents" : tab === "settings" ? "WhatsApp settings" : "Contacts"}
            </h1>
            <p>
              {tab === "inbox"
                ? "Manage customer conversations"
                : tab === "templates"
                  ? "Create and manage WhatsApp-approved messages"
                  : tab === "send-template" ? "Send an approved message to contacts or an audience"
                  : tab === "audiences" ? "Create and manage reusable contact groups"
                  : tab === "whatsapp-flows" ? "Create forms and booking experiences inside WhatsApp"
                  : tab === "agents" ? "Create accounts for your shared inbox team" : tab === "settings" ? "Onboard and manage business-owned WhatsApp accounts" : "Manage customers and start conversations"}
            </p>
          </div>
          <div className="head-actions">
            <button
              title={whatsapp?.error || whatsapp?.displayPhoneNumber || "Checking Meta connection"}
              onClick={() =>
                api
                  .whatsappHealth()
                  .then(setWhatsapp)
                  .catch((error) => setWhatsapp({ connected: false, error: error.message }))
              }
              className="connected transition-colors hover:border-relay-500"
            >
              <i className={whatsapp?.connected ? "" : "!bg-amber-500"} />{" "}
              {whatsapp === null
                ? "Checking WhatsApp…"
                : whatsapp.connected
                  ? "WhatsApp connected"
                  : "WhatsApp disconnected"}
            </button>
            <button className="transition-colors hover:bg-relay-50 hover:text-relay-600">
              <Bell />
            </button>
          </div>
        </header>
        {tab === "inbox" ? (
          <div className={"inbox-grid " + (conversation ? "has-conversation" : "")}>
            <section className="chat-list">
              <div className="search">
                <Search />
                <input
                  placeholder="Search conversations"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="filters">
                <button
                  className={filter === "all" ? "active" : ""}
                  onClick={() => setFilter("all")}
                >
                  All <b>{conversations.filter((c) => !c.archivedAt).length}</b>
                </button>
                <button
                  className={filter === "unread" ? "active" : ""}
                  onClick={() => setFilter("unread")}
                >
                  Unread {unreadCount > 0 && <b>{unreadCount}</b>}
                </button>
                <button
                  className={filter === "archived" ? "active" : ""}
                  onClick={() => setFilter("archived")}
                >
                  Archived
                </button>
              </div>
              <div className="conversations">
                {filtered.map((c) => {
                  const name = c.contact.profileName || c.contact.phone,
                    initials = getInitials(name),
                    last = c.messages[0];
                  return (
                    <button
                      key={c.id}
                      className={active === c.id ? "conversation active" : "conversation"}
                      onClick={() => setActive(c.id)}
                    >
                      <span className="contact-avatar" style={{ background: avatarColor(c.id) }}>
                        {initials}
                        <i />
                      </span>
                      <span className="conversation-copy">
                        <span>
                          <b>{name}</b>
                          <time>{formatTime(c.lastMessageAt)}</time>
                        </span>
                        <span>
                          <small>{last?.body || `[${last?.type || "message"}]`}</small>
                          {(Number(c.unreadCount) || 0) > 0 && <i>{Number(c.unreadCount) || 0}</i>}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {!loading && !filtered.length && (
                  <div className="px-4 py-10 text-center text-xs text-slate-400">
                    No {filter === "all" ? "" : filter} conversations
                  </div>
                )}
              </div>
            </section>
            {conversation ? (
              <ConversationView
                conversation={conversation}
                messages={chatMessages}
                draft={draft}
                setDraft={setDraft}
                send={send}
                sending={sending}
                onTemplate={() => setTemplateSend(true)}
                canInteract={canInteract}
                canClaim={!conversation?.claimedBy}
                isClaimant={conversation?.claimedBy?.id === user.id}
                onClaim={async claim => { const updated = await api.claimConversation(conversation.id, claim); setConversations(current => current.map(item => item.id === updated.id ? updated : item)); }}
                onBack={() => setActive("")}
                onArchive={() =>
                  changeConversation(
                    conversation.id,
                    conversation.archivedAt ? "unarchive" : "archive",
                  )
                }
              />
            ) : (
              <section className="thread flex items-center justify-center p-10 text-center text-slate-500">
                <div className="flex max-w-sm flex-col items-center">
                  <span className="grid size-14 place-items-center rounded-2xl bg-relay-100 text-relay-600">
                    <MessageCircle />
                  </span>
                  <h2 className="mt-4 font-display text-lg font-bold text-slate-800">
                    {loading ? "Loading inbox…" : "Your inbox is ready"}
                  </h2>
                  <p className={"mt-2 text-xs leading-6 " + (error ? "text-red-600" : "")}>
                    {error ||
                      "Send a WhatsApp message to your Meta test number. It will appear here after the webhook is connected."}
                  </p>
                </div>
              </section>
            )}
            {conversation && (
              <ContactDetails
                conversation={conversation}
                change={(action) => changeConversation(conversation.id, action)}
                agents={agents}
                user={user}
                assign={async assigneeId => { const updated = await api.assignConversation(conversation.id, assigneeId); setConversations(current => current.map(item => item.id === updated.id ? updated : item)); }}
              />
            )}
          </div>
        ) : tab === "templates" ? (
          <Templates templates={templates} onNew={() => setModal(true)} onEdit={setEditingTemplate} onDelete={async (template) => {
            if (!window.confirm(`Delete ${template.name} from Meta and this app?`)) return;
            try { await api.deleteTemplate(template.id); setTemplates(current => current.filter(item => item.id !== template.id)); }
            catch (e) { setError(e instanceof Error ? e.message : "Unable to delete template"); }
          }} />
        ) : tab === "send-template" ? (
          <BulkTemplateSend templates={templates} contacts={contacts} audiences={audiences} />
        ) : tab === "audiences" ? (
          <Audiences audiences={audiences} contacts={contacts} refresh={async () => setAudiences(await api.audiences())} />
        ) : tab === "whatsapp-flows" ? (
          <WhatsAppFlows user={user} />
        ) : tab === "contacts" ? (
          <Contacts
            contacts={contacts}
            onNew={() => setContactModal(true)}
            open={(contact, asTemplate) => {
              const item = contact.conversations[0];
              if (!item) return;
              if (!conversations.some((c) => c.id === item.id))
                setConversations((current) => [
                  {
                    ...item,
                    contact: {
                      id: contact.id,
                      waId: contact.waId,
                      phone: contact.phone,
                      profileName: contact.profileName,
                    },
                    messages: [],
                    assignee: null,
                    claimedBy: null,
                  },
                  ...current,
                ]);
              setActive(item.id);
              setTab("inbox");
              if (asTemplate) setTemplateSend(true);
            }}
          />
        ) : tab === "settings" ? (
          <EmbeddedSignup />
        ) : <Agents agents={agents} onNew={() => setAgentModal(true)} />}
      </section>
      {modal && (
        <TemplateModal
          close={() => setModal(false)}
          created={(template) => setTemplates((current) => [template, ...current])}
        />
      )}
      {editingTemplate && (
        <TemplateModal template={editingTemplate} close={() => setEditingTemplate(null)} created={(template) => setTemplates(current => current.map(item => item.id === template.id ? template : item))} />
      )}
      {flowModal && (
        <FlowModal flow={flowModal === true ? undefined : flowModal} triggers={triggers} templates={templates} close={() => setFlowModal(null)} saved={(flow) => { setFlows(current => current.some(item => item.id === flow.id) ? current.map(item => item.id === flow.id ? flow : item) : [flow, ...current]); setFlowModal(null); }} onCreateTemplate={() => { setFlowModal(null); setModal(true); setTab("templates"); }} />
      )}
      {triggerModal && (
        <TriggerModal close={() => setTriggerModal(false)} created={(trigger) => { setTriggers(current => [...current, trigger]); setTriggerModal(false); }} />
      )}
      {contactModal && (
        <ContactModal
          close={() => setContactModal(false)}
          created={(contact) => setContacts((current) => [contact, ...current])}
        />
      )}
      {templateSend && conversation && (
        <SendTemplateModal
          templates={templates}
          close={() => setTemplateSend(false)}
          send={async (name, language, parameters, options) => {
            const message = await api.sendTemplate(conversation.id, { name, language, parameters, ...options });
            setChatMessages((current) => [...current, message]);
            setTemplateSend(false);
          }}
        />
      )}
      {agentModal && <AgentModal close={() => setAgentModal(false)} created={agent => { setAgents(current => [agent, ...current]); setAgentModal(false); }} />}
    </div>
  );
}

function ConversationView({
  conversation,
  messages,
  draft,
  setDraft,
  send,
  sending,
  onTemplate,
  canInteract,
  canClaim,
  isClaimant,
  onClaim,
  onBack,
  onArchive,
}: {
  conversation: ApiConversation;
  messages: ApiMessage[];
  draft: string;
  setDraft: (value: string) => void;
  send: () => void;
  sending: boolean;
  onTemplate: () => void;
  canInteract: boolean;
  canClaim: boolean;
  isClaimant: boolean;
  onClaim: (claim: boolean) => void;
  onBack: () => void;
  onArchive: () => void;
}) {
  const name = conversation.contact.profileName || conversation.contact.phone;
  return (
    <section className="thread">
      <div className="thread-head">
        <button className="mobile-back" aria-label="Back to conversations" onClick={onBack}>
          ←
        </button>
        <div className="contact-avatar big" style={{ background: avatarColor(conversation.id) }}>
          {getInitials(name)}
          <i />
        </div>
        <div className="thread-contact">
          <b>{name}</b>
          <small>+{conversation.contact.phone}</small>
        </div>
        <div className="thread-actions">
          {canClaim || isClaimant ? <button className="template-action" onClick={() => onClaim(!isClaimant)}>
            <Check />
            <span>{isClaimant ? "Release" : "Claim"}</span>
          </button> : null}
          {canInteract && <button
            className="template-action"
            disabled={Boolean(conversation.closedAt)}
            onClick={onTemplate}
          >
            <FileText />
            <span>Template</span>
          </button>}
          <button
            aria-label={conversation.archivedAt ? "Unarchive conversation" : "Archive conversation"}
            title={conversation.archivedAt ? "Unarchive conversation" : "Archive conversation"}
            onClick={onArchive}
          >
            <Archive />
          </button>
          <button aria-label="More options">
            <MoreHorizontal />
          </button>
        </div>
      </div>
      <div className="messages">
        <div className="day">
          {conversation.closedAt ? "CLOSED · REOPEN TO REPLY" : "CONVERSATION"}
        </div>
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {!messages.length && (
          <div className="m-auto text-xs text-slate-400">No messages in this conversation</div>
        )}
      </div>
      {canInteract ? <div className="composer">
        <button aria-label="Add attachment" disabled={Boolean(conversation.closedAt)}>
          <Plus />
        </button>
        <div>
          <textarea
            rows={1}
            placeholder={
              conversation.closedAt
                ? "Reopen this conversation to send a message"
                : "Type a message..."
            }
            value={draft}
            disabled={sending || Boolean(conversation.closedAt)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <span>
            <button aria-label="Attach file" disabled={Boolean(conversation.closedAt)}>
              <Paperclip />
            </button>
            <button aria-label="Add emoji" disabled={Boolean(conversation.closedAt)}>
              <Smile />
            </button>
          </span>
        </div>
        <button
          aria-label="Send message"
          className="send disabled:cursor-not-allowed disabled:opacity-45"
          disabled={sending || !draft.trim() || Boolean(conversation.closedAt)}
          onClick={send}
        >
          <Send />
        </button>
      </div> : <div className="composer-readonly" style={{ display: "block", width: "100%", padding: "12px 16px", borderTop: "1px solid #e0e6e2", background: "white", textAlign: "center", color: "#76837c", fontSize: 12, lineHeight: 1.5, overflowWrap: "anywhere" }}>
        {conversation.claimedBy ? `Claimed by ${conversation.claimedBy.name}. Only the claiming agent or assigned agent can interact.` : "Claim this conversation to send messages."}
      </div>}
    </section>
  );
}

function MessageBubble({ message }: { message: ApiMessage }) {
  const components = Array.isArray(message.templateComponents) ? message.templateComponents : [];
  const header = components.find((component) => component.type?.toUpperCase() === "HEADER");
  const footer = components.find((component) => component.type?.toUpperCase() === "FOOTER");
  const buttons =
    components.find((component) => component.type?.toUpperCase() === "BUTTONS")?.buttons || [];
  const isReply = ["button", "interactive"].includes(message.type);
  return (
    <div className={"bubble " + (message.direction === "OUTBOUND" ? "me" : "them")}>
      {message.type === "template" && (
        <b className="mb-1 text-[8px] uppercase tracking-wider text-relay-600">
          Template · {titleCase(message.templateName || "message")}
        </b>
      )}
      {header?.text && <b className="mb-1 text-xs">{header.text}</b>}
      {isReply && (
        <b className="mb-1 text-[8px] uppercase tracking-wider text-blue-600">Button reply</b>
      )}
      <div>{message.body || `[${message.type} message]`}</div>
      {footer?.text && <small className="mt-2 text-[9px] text-slate-500">{footer.text}</small>}
      {!footer?.text && (footer as any)?.code_expiration_minutes && (
        <small className="mt-2 text-[9px] text-slate-500">
          This code expires in {(footer as any).code_expiration_minutes} minutes.
        </small>
      )}
      {buttons.length > 0 && (
        <div className="template-buttons">
          {buttons.map((button: any, index: number) => (
            <button
              key={`${button.type}-${index}`}
              type="button"
              title="Preview only — the recipient uses this button in WhatsApp"
            >
              {button.type === "PHONE_NUMBER"
                ? "☎ "
                : button.type === "URL"
                  ? "↗ "
                  : button.type === "OTP"
                    ? "⧉ "
                    : "↩ "}
              {button.text || button.otp_type?.replaceAll("_", " ") || "Action"}
            </button>
          ))}
        </div>
      )}
      <span className={message.status === "FAILED" ? "message-failed" : ""}>
        {formatTime(message.createdAt)}
        {message.direction === "OUTBOUND" && (
          <>
            {" "}
            · {message.status.toLowerCase()}
            {message.status === "READ" ? (
              <CheckCheck className="text-blue-500" size={14} />
            ) : message.status === "DELIVERED" ? (
              <CheckCheck size={14} />
            ) : (
              <Check size={14} />
            )}
          </>
        )}
        {message.errorMessage && <i title={message.errorMessage}>!</i>}
      </span>
    </div>
  );
}

function ContactDetails({
  conversation,
  change,
  agents,
  user,
  assign,
}: {
  conversation: ApiConversation;
  change: (action: "open" | "close") => void;
  agents: ApiUser[];
  user: ApiUser;
  assign: (assigneeId: string|null) => void;
}) {
  const name = conversation.contact.profileName || conversation.contact.phone;
  const canChangeAssignment = user.role === "ADMIN" || conversation.claimedBy?.id === user.id;
  return (
    <aside className="details">
      <div className="detail-person">
        <span className="contact-avatar xl" style={{ background: avatarColor(conversation.id) }}>
          {getInitials(name)}
        </span>
        <h3>{name}</h3>
        <p>+{conversation.contact.phone}</p>
      </div>
      <div className="detail-block">
        <h4>CONTACT DETAILS</h4>
        <label>
          <UserRound /> Phone<span>+{conversation.contact.phone}</span>
        </label>
        <label>
          <MessageCircle /> Channel<span>WhatsApp</span>
        </label>
      </div>
      <div className="detail-block">
        <h4>CONVERSATION</h4>
        <label>Assigned to {canChangeAssignment ? <select className="select" value={conversation.assignee?.id || ""} onChange={e => assign(e.target.value || null)}><option value="">Unassigned</option>{agents.filter(agent => agent.active !== false).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select> : <span>{conversation.assignee?.name || "Unassigned"}</span>}</label>
        {conversation.claimedBy && <label>Claimed by <span>{conversation.claimedBy.name}</span></label>}
        <label>
          Status{" "}
          <select
            className="select"
            aria-label="Conversation status"
            value={conversation.closedAt ? "closed" : "open"}
            onChange={(e) => change(e.target.value as "open" | "close")}
          >
            <option value="open">Open</option>
            <option value="close">Closed</option>
          </select>
        </label>
        <p className="text-[10px] leading-4 text-slate-400">
          Closing marks this conversation resolved and disables replies. A new customer message
          reopens it automatically.
        </p>
        <label>
          Last message <span>{formatTime(conversation.lastMessageAt)}</span>
        </label>
      </div>
      <button className="danger">Block contact</button>
    </aside>
  );
}

function Login({ onLogin }: { onLogin: (user: ApiUser) => void }) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setLoading(true); setError(""); try { const result = await api.login(email, password); localStorage.setItem("relay_token", result.token); onLogin(result.user); } catch (e) { setError(e instanceof Error ? e.message : "Unable to sign in"); } finally { setLoading(false); } };
  return <main className="login-page"><form className="login-card" onSubmit={submit}><span className="login-logo"><MessageCircle /></span><h1>Welcome to Admin Panel</h1><p>Sign in to your shared WhatsApp inbox.</p><label>Email<input autoFocus type="email" placeholder="admin@company.com" value={email} onChange={e => setEmail(e.target.value)} /></label><label>Password<input type="password" placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} /></label>{error && <div className="login-error">{error}</div>}<button className="new-template" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button></form></main>;
}

function Agents({ agents, onNew }: { agents: ApiUser[]; onNew: () => void }) {
  return <div className="templates"><div className="template-tools"><div><h2 className="m-0 font-display text-lg font-bold">Shared inbox team</h2><p className="mt-1 text-xs text-slate-500">Agents can sign in and handle assigned conversations.</p></div><button className="new-template" onClick={onNew}><UserPlus />Create agent</button></div><div className="template-card">{agents.map(agent => <div className="agent-row" key={agent.id}><span className="contact-avatar" style={{background: avatarColor(agent.id)}}>{getInitials(agent.name)}</span><span><b>{agent.name}</b><small>{agent.email}</small></span><i>{titleCase(agent.role)}</i><em>{agent.active === false ? "Disabled" : "Active"}</em></div>)}</div></div>;
}

function AgentModal({ close, created }: { close: () => void; created: (agent: ApiUser) => void }) {
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [password, setPassword] = useState(""), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const submit = async () => { setSaving(true); setError(""); try { created(await api.createAgent({name,email,password})); } catch(e) { setError(e instanceof Error ? e.message : "Unable to create agent"); setSaving(false); } };
  return <div className="overlay"><div className="modal"><div className="modal-head"><div><h2>Create agent</h2><p>Give this login to a team member who handles conversations.</p></div><button onClick={close}><X /></button></div><label>Full name<input value={name} onChange={e => setName(e.target.value)} placeholder="Agent name" /></label><label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="agent@company.com" /></label><label>Temporary password<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" /></label>{error && <p className="text-xs text-red-600">{error}</p>}<div className="modal-actions"><button onClick={close}>Cancel</button><button className="new-template" disabled={saving || !name || !email || password.length < 8} onClick={submit}>{saving ? "Creating…" : "Create agent"}</button></div></div></div>;
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
function avatarColor(id: string) {
  const colors = ["#e35d83", "#6558da", "#dc8f39", "#2f9c72"];
  return colors[id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length];
}
function formatTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function Templates({ templates, onNew, onEdit, onDelete }: { templates: ApiTemplate[]; onNew: () => void; onEdit: (template: ApiTemplate) => void; onDelete: (template: ApiTemplate) => void }) {
  const [query, setQuery] = useState(""),
    filtered = templates.filter(
      (template) =>
        template.name.toLowerCase().includes(query.toLowerCase()) ||
        template.category.toLowerCase().includes(query.toLowerCase()),
    );
  return (
    <div className="templates">
      <div className="template-tools">
        <div className="search">
          <Search />
          <input
            placeholder="Search templates"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="new-template" onClick={onNew}>
          <Plus /> Create template
        </button>
      </div>
      <div className="template-card">
        <div className="template-row table-head">
          <span>Name</span>
          <span>Category</span>
          <span>Status</span>
          <span>Updated</span>
          <span />
        </div>
        {filtered.map((t) => (
          <div className="template-row" key={t.id}>
            <span>
              <i className="doc">
                <FileText />
              </i>
              <b>{titleCase(t.name)}</b>
              <small>
                {t.name} · {t.language}
              </small>
            </span>
            <span>{titleCase(t.category)}</span>
            <span>
              <i className={"status " + t.status.toLowerCase()} />
              {titleCase(t.status)}
            </span>
            <span>{formatTime(t.updatedAt)}</span>
            <span className="flex gap-1" title={t.rejectionReason || `${titleCase(t.category)} template`}>
              {<button disabled={!["APPROVED", "REJECTED", "PAUSED"].includes(t.status)} aria-label="Edit template" title="Edit template" onClick={() => onEdit(t)}><Pencil className="size-4 text-slate-500" /></button>}
              <button aria-label="Delete template" title="Delete from Meta" onClick={() => onDelete(t)}><Trash2 className="size-4 text-red-500" /></button>
            </span>
          </div>
        ))}
        {!filtered.length && (
          <div className="p-10 text-center text-xs text-slate-400">No matching templates found</div>
        )}
      </div>
    </div>
  );
}

function templateBodyText(template?: ApiTemplate) {
  return template?.components.find((c: any) => c.type?.toUpperCase() === "BODY")?.text || "";
}
function templateDynamicUrlButtons(template?: ApiTemplate) {
  const component: any = (template?.components as any[])?.find(c => c.type?.toUpperCase() === "BUTTONS");
  return (component?.buttons || []).filter((button: any) => button.type === "URL" && String(button.url).includes("{{1}}"));
}
function isSimpleTemplate(template: ApiTemplate) {
  return supportsAutomaticTemplate(template);
}
function variableCount(body: string) {
  return variableKeys(body).length;
}
function Automations({ flows, triggers, onNew, onNewTrigger, onDeleteTrigger, onEdit, onToggle, onDelete }: {
  flows: ApiAutomationFlow[]; triggers: ApiAutomationTrigger[]; onNew: () => void; onNewTrigger: () => void;
  onDeleteTrigger: (trigger: ApiAutomationTrigger) => void;
  onEdit: (flow: ApiAutomationFlow) => void; onToggle: (flow: ApiAutomationFlow) => void; onDelete: (flow: ApiAutomationFlow) => void;
}) {
  return <div className="templates">
    <div className="template-tools">
      <div><h2 className="m-0 font-display text-lg font-bold">Client-controlled messaging</h2><p className="mt-1 text-xs text-slate-500">An event can run one or more enabled message actions.</p></div>
      <div className="flex gap-2"><button className="rounded-lg border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600" onClick={onNewTrigger}><Zap className="mr-1 inline size-4" />New trigger</button><button className="new-template" onClick={onNew}><Plus /> Create flow</button></div>
    </div>
    <div className="mb-5 flex flex-wrap gap-2">{triggers.map(trigger => <span key={trigger.id} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-600"><Zap className="mr-1 inline size-3 text-relay-500" />{trigger.name}{trigger.system ? <b className="ml-1 text-[8px] uppercase text-slate-400">Built-in</b> : <button className="ml-2 border-0 bg-transparent p-0 text-red-400" aria-label={`Delete ${trigger.name}`} onClick={() => onDeleteTrigger(trigger)}>×</button>}</span>)}</div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {flows.map(flow => {
        const trigger = triggers.find(item => item.key === flow.trigger);
        return <article key={flow.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-lg bg-relay-50 text-relay-600"><Workflow className="size-4" /></span><div className="min-w-0 flex-1"><h3 className="m-0 truncate text-sm font-bold">{flow.name}</h3><p className="mt-1 text-[10px] text-slate-400">When {trigger?.name || titleCase(flow.trigger)}</p></div><button aria-label="Toggle flow" onClick={() => onToggle(flow)} className={`h-5 w-9 rounded-full border-0 p-0.5 ${flow.enabled ? "bg-relay-500" : "bg-slate-300"}`}><i className={`block size-4 rounded-full bg-white transition ${flow.enabled ? "translate-x-4" : ""}`} /></button></div>
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-[11px] leading-5 text-slate-600"><b>{flow.actionType === "MESSAGE" ? "Custom message" : "Approved template"}</b><p className="m-0 line-clamp-2">{flow.actionType === "MESSAGE" ? flow.messageBody : flow.template?.name || "Missing template"}</p></div>
          <div className="mt-3 flex justify-end gap-2 border-t border-slate-100 pt-3"><button className="rounded-md border border-slate-200 px-3 py-1.5 text-[10px] font-bold" onClick={() => onEdit(flow)}><Pencil className="mr-1 inline size-3" />Edit</button><button className="rounded-md border border-red-100 px-3 py-1.5 text-[10px] font-bold text-red-600" onClick={() => onDelete(flow)}><Trash2 className="mr-1 inline size-3" />Delete</button></div>
        </article>;
      })}
      {!flows.length && <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center"><Workflow className="mx-auto size-8 text-slate-300" /><h3 className="mt-3 text-sm font-bold">No messaging flows yet</h3><p className="text-xs text-slate-400">Appointment bookings will not send an automatic confirmation until a flow is enabled.</p></div>}
    </div>
  </div>;
}

function FlowModal({ flow, triggers, templates, close, saved, onCreateTemplate }: { flow?: ApiAutomationFlow; triggers: ApiAutomationTrigger[]; templates: ApiTemplate[]; close: () => void; saved: (flow: ApiAutomationFlow) => void; onCreateTemplate: () => void }) {
  const [name, setName] = useState(flow?.name || ""), [triggerKey, setTriggerKey] = useState(flow?.trigger || triggers[0]?.key || ""), [actionType, setActionType] = useState<"MESSAGE"|"TEMPLATE">(flow?.actionType || "MESSAGE"), [messageBody, setMessageBody] = useState(flow?.messageBody || ""), [templateId, setTemplateId] = useState(flow?.templateId || ""), [mappings, setMappings] = useState<string[]>(Array.isArray(flow?.parameterMappings) ? flow!.parameterMappings! : []), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const trigger = triggers.find(item => item.key === triggerKey), approved = templates.filter(item => item.status === "APPROVED" && isSimpleTemplate(item)), template = approved.find(item => item.id === templateId);
  const bodyCount = template?.category === "AUTHENTICATION" ? 1 : variableCount(templateBodyText(template)), dynamicCount = templateDynamicUrlButtons(template).length, parameterCount = template ? bodyCount + dynamicCount : 0;
  useEffect(() => setMappings(current => Array.from({ length: parameterCount }, (_, index) => current[index] || trigger?.fields[0]?.key || "")), [parameterCount, triggerKey]);
  const insertField = (key: string) => setMessageBody(current => `${current}${current && !/\s$/.test(current) ? " " : ""}{{${key}}}`);
  const submit = async () => { setSaving(true); setError(""); try { const payload = { name, trigger: triggerKey, enabled: flow?.enabled ?? true, actionType, messageBody, templateId, parameterMappings: mappings }; saved(flow ? await api.updateAutomationFlow(flow.id, payload) : await api.createAutomationFlow(payload)); } catch (e) { setError(e instanceof Error ? e.message : "Unable to save flow"); setSaving(false); } };
  return <div className="overlay"><div className="modal max-h-[90vh] overflow-auto"><div className="modal-head"><div><h2>{flow ? "Edit automation flow" : "Create automation flow"}</h2><p>The client controls the trigger and outgoing content.</p></div><button onClick={close}><X /></button></div>
    <label>Flow name<input value={name} onChange={e => setName(e.target.value)} placeholder="Appointment confirmation" /></label>
    <label>Trigger<select value={triggerKey} onChange={e => setTriggerKey(e.target.value)}>{triggers.map(item => <option key={item.id} value={item.key}>{item.name}</option>)}</select></label>
    <label>Send<select value={actionType} onChange={e => setActionType(e.target.value as any)}><option value="MESSAGE">Custom message</option><option value="TEMPLATE">Approved template</option></select></label>
    {actionType === "MESSAGE" ? <><label>Message<textarea maxLength={4096} value={messageBody} onChange={e => setMessageBody(e.target.value)} placeholder="Your appointment {{booking_reference}} is confirmed." /></label><div className="flex flex-wrap gap-1">{trigger?.fields.map(field => <button key={field.key} type="button" className="rounded-md bg-relay-50 px-2 py-1 text-[10px] font-bold text-relay-700" onClick={() => insertField(field.key)}>+ {field.label}</button>)}</div><p className="text-[10px] leading-4 text-amber-700">Custom text can only be delivered while the customer's 24-hour service window is open. Use an approved template when the event may happen outside it.</p></> : <><label>Approved template<select value={templateId} onChange={e => setTemplateId(e.target.value)}><option value="">Select template</option>{approved.map(item => <option key={item.id} value={item.id}>{item.name} ({item.language})</option>)}</select></label><button type="button" className="text-xs font-bold text-relay-600" onClick={onCreateTemplate}>+ Create a new template</button>{mappings.map((mapping, index) => <label key={index}>{index < bodyCount ? `Template field ${index + 1}` : `Dynamic URL field ${index - bodyCount + 1}`}<select value={mapping} onChange={e => setMappings(current => current.map((item, i) => i === index ? e.target.value : item))}>{trigger?.fields.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>)}</>}
    {error && <p className="mt-3 text-xs text-red-600">{error}</p>}<div className="modal-actions"><button onClick={close}>Cancel</button><button className="new-template disabled:opacity-50" disabled={saving || !name || !triggerKey || (actionType === "MESSAGE" ? !messageBody : !templateId)} onClick={submit}>{saving ? "Saving…" : "Save flow"}</button></div>
  </div></div>;
}

function TriggerModal({ close, created }: { close: () => void; created: (trigger: ApiAutomationTrigger) => void }) {
  const [name, setName] = useState(""), [description, setDescription] = useState(""), [fields, setFields] = useState([{ key: "", label: "" }]), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const submit = async () => { setSaving(true); setError(""); try { created(await api.createAutomationTrigger({ name, description, fields })); } catch (e) { setError(e instanceof Error ? e.message : "Unable to create trigger"); setSaving(false); } };
  return <div className="overlay"><div className="modal"><div className="modal-head"><div><h2>Create custom trigger</h2><p>Define the data your backend supplies when this event fires.</p></div><button onClick={close}><X /></button></div><label>Trigger name<input value={name} onChange={e => setName(e.target.value)} placeholder="Payment received" /></label><label>Description<input value={description} onChange={e => setDescription(e.target.value)} placeholder="Runs after a successful payment" /></label><div className="mt-4"><b className="text-xs">Event fields</b>{fields.map((field, index) => <div key={index} className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2"><input className="!mt-0 rounded-lg border border-slate-200 p-2 text-xs" value={field.label} onChange={e => setFields(current => current.map((item, i) => i === index ? { label: e.target.value, key: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") } : item))} placeholder="Amount" /><input className="!mt-0 rounded-lg border border-slate-200 p-2 text-xs" value={field.key} onChange={e => setFields(current => current.map((item, i) => i === index ? { ...item, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") } : item))} placeholder="amount" /><button onClick={() => setFields(current => current.filter((_, i) => i !== index))}><Trash2 className="size-4 text-red-500" /></button></div>)}<button className="mt-2 text-xs font-bold text-relay-600" onClick={() => setFields(current => [...current, { key: "", label: "" }])}>+ Add field</button></div>{error && <p className="text-xs text-red-600">{error}</p>}<div className="modal-actions"><button onClick={close}>Cancel</button><button className="new-template disabled:opacity-50" disabled={saving || !name || fields.some(field => !field.key || !field.label)} onClick={submit}>{saving ? "Creating…" : "Create trigger"}</button></div></div></div>;
}

function Contacts({
  contacts,
  onNew,
  open,
}: {
  contacts: ApiContact[];
  onNew: () => void;
  open: (contact: ApiContact, template: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = contacts.filter((c) =>
    (c.profileName || c.phone).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="flex-1 overflow-auto bg-slate-50 p-6 max-md:p-3">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="search max-w-sm flex-1">
          <Search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contacts"
          />
        </div>
        <button className="new-template" onClick={onNew}>
          <UserPlus /> Add contact
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((contact) => {
          const conversation = contact.conversations[0],
            windowOpen = Boolean(
              conversation?.lastCustomerMessageAt &&
              Date.now() - new Date(conversation.lastCustomerMessageAt).getTime() < 86400000,
            ),
            name = contact.profileName || contact.phone;
          return (
            <article
              key={contact.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <span
                  className="grid size-11 shrink-0 place-items-center rounded-xl text-xs font-bold text-white"
                  style={{ background: avatarColor(contact.id) }}
                >
                  {getInitials(name)}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-bold text-slate-800">{name}</h3>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                    <Phone className="size-3" /> +{contact.phone}
                  </p>
                </div>
                <span
                  className={
                    "size-2 rounded-full " + (windowOpen ? "bg-relay-500" : "bg-slate-300")
                  }
                  title={windowOpen ? "24-hour window open" : "Template required"}
                />
              </div>
              <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
                <button
                  disabled={!windowOpen}
                  onClick={() => open(contact, false)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  title={
                    windowOpen
                      ? "Open conversation"
                      : "A customer message is required before sending free-form text"
                  }
                >
                  <MessageCircle className="size-3.5" /> Message
                </button>
                <button
                  onClick={() => open(contact, true)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-relay-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-relay-600"
                >
                  <FileText className="size-3.5" /> Template
                </button>
              </div>
              {!windowOpen && (
                <p className="mt-2 text-center text-[10px] text-slate-400">
                  24-hour window closed · template required
                </p>
              )}
            </article>
          );
        })}
      </div>
      {!filtered.length && (
        <div className="grid min-h-72 place-items-center text-center">
          <div>
            <UserRound className="mx-auto size-9 text-slate-300" />
            <h3 className="mt-3 text-sm font-bold text-slate-600">No contacts found</h3>
            <p className="mt-1 text-xs text-slate-400">Add a contact with their WhatsApp number.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ContactModal({
  close,
  created,
}: {
  close: () => void;
  created: (contact: ApiContact) => void;
}) {
  const [name, setName] = useState(""),
    [countryCode, setCountryCode] = useState("91"),
    [phone, setPhone] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const localNumber = phone.replace(/\D/g, ""),
    internationalNumber = `${countryCode}${localNumber}`;
  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const contact = await api.createContact({ name, phone: internationalNumber });
      created(contact);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to add contact");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="overlay">
      <div className="modal">
        <div className="modal-head">
          <div>
            <h2>Add WhatsApp contact</h2>
            <p>Select a country code and enter the number without it.</p>
          </div>
          <button onClick={close}>
            <X />
          </button>
        </div>
        <label>
          Contact name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Nair" />
        </label>
        <label>
          WhatsApp number
          <div className="mt-2 grid grid-cols-[140px_1fr] gap-2">
            <select
              className="mt-0"
              aria-label="Country code"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
            >
              <option value="91">India (+91)</option>
              <option value="1">US/Canada (+1)</option>
              <option value="44">UK (+44)</option>
              <option value="61">Australia (+61)</option>
              <option value="65">Singapore (+65)</option>
              <option value="971">UAE (+971)</option>
              <option value="966">Saudi Arabia (+966)</option>
            </select>
            <input
              className="mt-0"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="9876543210"
            />
          </div>
          <small className="mt-2 block font-normal text-slate-400">
            Will be sent to Meta as +{internationalNumber || countryCode}
          </small>
        </label>
        <div className="mt-3 rounded-lg bg-amber-50 p-3 text-[11px] leading-5 text-amber-800">
          For Meta test numbers, first add and verify this recipient in Meta's Try it out section.
          Adding it here only creates the contact in this inbox. New contacts must receive an
          approved template first; free-form messages are available after they reply.
        </div>
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        <div className="modal-actions">
          <button onClick={close}>Cancel</button>
          <button
            disabled={saving || !name.trim() || localNumber.length < 6}
            className="new-template disabled:opacity-50"
            onClick={submit}
          >
            {saving ? "Adding…" : "Add contact"}
          </button>
        </div>
      </div>
    </div>
  );
}
