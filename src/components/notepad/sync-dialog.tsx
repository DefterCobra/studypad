"use client";

/**
 * Cloud save dialog — pick Supabase / Firebase (or the self-hosted server),
 * add or update the connection settings, sign in, see the sync status, sync
 * on demand, and resolve conflicts. Opens by itself when a conflict needs a
 * decision.
 */
import { useState } from "react";
import {
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  Copy,
  Info,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  connect,
  disconnect,
  resolveConflict,
  syncNow,
  useSyncStore,
} from "@/lib/notepad/sync";
import {
  FIREBASE_SETUP_RULES,
  SUPABASE_SETUP_SQL,
  type CloudConfig,
  type Provider,
} from "@/lib/notepad/sync-backends";

const PROVIDER_LABEL: Record<Provider, string> = {
  supabase: "Supabase",
  firebase: "Firebase",
  server: "Self-hosted server",
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  testId?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type={type}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
      />
    </div>
  );
}

interface GuideStep {
  title: string;
  body: string;
  snippet?: string;
  snippetLabel?: string;
}

const GUIDES: Record<
  "supabase" | "firebase",
  { intro: string; steps: GuideStep[]; tip: string }
> = {
  supabase: {
    intro:
      "Free tier is plenty. You do this once; every device then just signs in.",
    steps: [
      {
        title: "1. Create a project",
        body: "Go to supabase.com → New project. Pick any name, region and database password (you will not need the password here).",
      },
      {
        title: "2. Copy URL + anon key",
        body: "Project settings → API. Paste “Project URL” into Project URL and the “anon / public” key into Anon key. Never use the service_role key — it bypasses security.",
      },
      {
        title: "3. Create the table",
        body: "SQL Editor → New query → paste this → Run. It creates the notes table and a policy so each user only sees their own rows.",
        snippet: SUPABASE_SETUP_SQL,
        snippetLabel: "SQL",
      },
      {
        title: "4. Allow email sign-in",
        body: "Authentication → Providers: make sure Email is enabled. For instant sign-up, turn off “Confirm email” (otherwise click the link in the email before signing in).",
      },
      {
        title: "5. Connect",
        body: "Back here: enter an email + password, then “Create account” the first time. On your other devices use the same URL, key and “Sign in & connect”.",
      },
    ],
    tip: "Error “Table studypad_pads not found” → step 3 was skipped. “Invalid login credentials” → wrong password, or the account is unconfirmed.",
  },
  firebase: {
    intro:
      "Uses Firebase Authentication + Cloud Firestore (free Spark plan is enough).",
    steps: [
      {
        title: "1. Create a project",
        body: "Go to console.firebase.google.com → Add project (Analytics not needed).",
      },
      {
        title: "2. Register a web app",
        body: "Project overview → the </> Web icon → give it a nickname → Register. Copy apiKey, projectId, appId (and authDomain) from the config shown into the fields here. Or find them later under Project settings → General → Your apps.",
      },
      {
        title: "3. Enable email sign-in",
        body: "Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.",
      },
      {
        title: "4. Create Firestore",
        body: "Build → Firestore Database → Create database (production mode, any region).",
      },
      {
        title: "5. Publish the security rules",
        body: "Firestore → Rules tab → replace the contents with this → Publish. It lets each signed-in user touch only their own notes.",
        snippet: FIREBASE_SETUP_RULES,
        snippetLabel: "Rules",
      },
      {
        title: "6. Connect",
        body: "Back here: enter an email + password, then “Create account” the first time. On other devices use the same config and “Sign in & connect”.",
      },
    ],
    tip: "Error “Firestore denied access” → step 5 rules not published. “auth/operation-not-allowed” → step 3 skipped. If you host the site on your own domain, add it under Authentication → Settings → Authorized domains.",
  },
};

function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative mt-1.5">
      <pre className="max-h-36 overflow-auto rounded bg-muted p-2 pr-16 text-[11px] leading-snug">
        {text}
      </pre>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="absolute right-1 top-1 h-6 gap-1 px-2 text-[10px]"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{" "}
        {copied ? "Copied" : `Copy ${label}`}
      </Button>
    </div>
  );
}

/** (i) button: exactly what to click in the provider's console */
function InfoGuide({ provider }: { provider: "supabase" | "firebase" }) {
  const g = GUIDES[provider];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`How to set up ${PROVIDER_LABEL[provider]}`}
          data-testid="sync-info"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[60dvh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain text-xs"
        data-testid="sync-info-panel"
        // The popover is portalled outside the Dialog, whose scroll lock swallows wheel / touch
        // scrolling anywhere else — stop those events before they reach the lock.
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold">
          Set up {PROVIDER_LABEL[provider]}
        </p>
        <p className="mt-1 text-muted-foreground">{g.intro}</p>
        <ol className="mt-3 space-y-3">
          {g.steps.map((st) => (
            <li key={st.title}>
              <p className="font-medium">{st.title}</p>
              <p className="mt-0.5 text-muted-foreground">{st.body}</p>
              {st.snippet ? (
                <CopyBlock
                  text={st.snippet}
                  label={st.snippetLabel ?? "text"}
                />
              ) : null}
            </li>
          ))}
        </ol>
        <p className="mt-3 rounded bg-amber-500/10 p-2 text-muted-foreground">
          {g.tip}
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function SyncDialog() {
  const open = useSyncStore((s) => s.dialogOpen);
  const setOpen = useSyncStore((s) => s.setDialogOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-h-[88dvh] overflow-y-auto sm:max-w-md"
        data-testid="sync-dialog"
      >
        {/* mounted only while open, so the form re-seeds from the saved settings each time */}
        <SyncBody />
      </DialogContent>
    </Dialog>
  );
}

function SyncBody() {
  const enabled = useSyncStore((s) => s.enabled);
  const saved = useSyncStore((s) => s.config);
  const account = useSyncStore((s) => s.account);
  const serverAvailable = useSyncStore((s) => s.serverAvailable === true);
  const status = useSyncStore((s) => s.status);
  const message = useSyncStore((s) => s.message);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const conflict = useSyncStore((s) => s.conflict);

  const [draft, setDraft] = useState<CloudConfig>(saved);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState("");
  const busy = status === "syncing";

  const providers: Provider[] =
    serverAvailable || saved.provider === "server"
      ? ["supabase", "firebase", "server"]
      : ["supabase", "firebase"];
  const provider = draft.provider;
  const needsAccount = provider !== "server";
  const sb = draft.supabase;
  const fb = draft.firebase;

  const submit = async (mode: "signin" | "signup") => {
    setFormError("");
    const creds =
      needsAccount && (email.trim() || password)
        ? { email, password, mode }
        : null;
    const r = await connect(draft, creds);
    if (r.ok) {
      setPassword("");
      setEditing(false);
      void syncNow();
    } else {
      setFormError(r.message);
    }
  };

  const statusLine = (() => {
    switch (status) {
      case "syncing":
        return {
          icon: <Loader2 className="h-4 w-4 animate-spin" />,
          text: message || "Syncing…",
        };
      case "synced":
        return {
          icon: <Check className="h-4 w-4 text-emerald-500" />,
          text: lastSyncedAt
            ? `Up to date · ${new Date(lastSyncedAt).toLocaleTimeString()}`
            : "Up to date",
        };
      case "offline":
        return {
          icon: <CloudOff className="h-4 w-4 text-amber-500" />,
          text: message,
        };
      case "error":
        return {
          icon: <AlertTriangle className="h-4 w-4 text-destructive" />,
          text: message,
        };
      case "conflict":
        return {
          icon: <AlertTriangle className="h-4 w-4 text-amber-500" />,
          text: "Changed on both sides",
        };
      default:
        return {
          icon: <Cloud className="h-4 w-4" />,
          text: enabled ? "Waiting to sync" : "Not connected",
        };
    }
  })();

  const showForm = !enabled || editing;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Cloud save</DialogTitle>
        <DialogDescription>
          Keep notes, flashcards and quizzes in your own Supabase or Firebase
          project so every device you sign in on shares them. Settings stay in
          this browser; your password is never stored.
        </DialogDescription>
      </DialogHeader>

      {conflict ? (
        <div className="space-y-3 text-sm">
          <p>
            This pad was changed in the cloud <em>and</em> on this device since
            the last sync. Which copy should win?
          </p>
          <p className="text-muted-foreground">
            Cloud copy saved{" "}
            {new Date(conflict.remote.updatedAt).toLocaleString()}. Taking the
            cloud copy keeps a backup of this device&apos;s version; keeping
            this device overwrites the cloud copy.
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => void resolveConflict("server")}
            >
              Use cloud copy
            </Button>
            <Button onClick={() => void resolveConflict("device")}>
              Keep this device
            </Button>
          </DialogFooter>
        </div>
      ) : !showForm ? (
        <div className="space-y-4">
          <div className="rounded-md border px-3 py-2 text-sm">
            <p className="font-medium">{PROVIDER_LABEL[saved.provider]}</p>
            {account ? (
              <p className="text-xs text-muted-foreground">
                Signed in as {account}
              </p>
            ) : null}
          </div>
          <div
            className="flex items-center gap-2 text-sm"
            data-testid="sync-status"
          >
            {statusLine.icon}
            <span>{statusLine.text}</span>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="ghost"
              onClick={() => setEditing(true)}
              data-testid="sync-edit"
            >
              Edit connection
            </Button>
            <Button variant="outline" onClick={() => void disconnect()}>
              Sign out
            </Button>
            <Button disabled={busy} onClick={() => void syncNow()}>
              Sync now
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit("signin");
          }}
        >
          <div className="flex items-center gap-2">
            <div
              className="grid flex-1 gap-1 rounded-lg bg-muted p-1"
              style={{
                gridTemplateColumns: `repeat(${providers.length}, 1fr)`,
              }}
              role="radiogroup"
              aria-label="Provider"
            >
              {providers.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={provider === p}
                  onClick={() => {
                    setDraft({ ...draft, provider: p });
                    setFormError("");
                  }}
                  data-testid={`sync-provider-${p}`}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                    provider === p
                      ? "bg-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {PROVIDER_LABEL[p]}
                </button>
              ))}
            </div>
            {provider !== "server" && <InfoGuide provider={provider} />}
          </div>

          {provider === "supabase" && (
            <>
              <Field
                label="Project URL"
                placeholder="https://xyzcompany.supabase.co"
                value={sb.url}
                onChange={(url) =>
                  setDraft({ ...draft, supabase: { ...sb, url } })
                }
                testId="sync-sb-url"
              />
              <Field
                label="Anon (public) key"
                type="password"
                placeholder="eyJhbGciOi…"
                value={sb.anonKey}
                onChange={(anonKey) =>
                  setDraft({ ...draft, supabase: { ...sb, anonKey } })
                }
                testId="sync-sb-key"
              />
            </>
          )}

          {provider === "firebase" && (
            <>
              <Field
                label="API key"
                type="password"
                placeholder="AIzaSy…"
                value={fb.apiKey}
                onChange={(apiKey) =>
                  setDraft({ ...draft, firebase: { ...fb, apiKey } })
                }
                testId="sync-fb-apikey"
              />
              <Field
                label="Project ID"
                placeholder="my-studypad"
                value={fb.projectId}
                onChange={(projectId) =>
                  setDraft({ ...draft, firebase: { ...fb, projectId } })
                }
                testId="sync-fb-project"
              />
              <Field
                label="App ID"
                placeholder="1:1234567890:web:abcdef"
                value={fb.appId}
                onChange={(appId) =>
                  setDraft({ ...draft, firebase: { ...fb, appId } })
                }
                testId="sync-fb-appid"
              />
              <Field
                label="Auth domain (optional)"
                placeholder="my-studypad.firebaseapp.com"
                value={fb.authDomain}
                onChange={(authDomain) =>
                  setDraft({ ...draft, firebase: { ...fb, authDomain } })
                }
              />
            </>
          )}

          {provider === "server" && (
            <Field
              label="Sync token"
              type="password"
              placeholder="STUDYPAD_SYNC_TOKEN"
              value={draft.serverToken}
              onChange={(serverToken) => setDraft({ ...draft, serverToken })}
              testId="sync-token"
            />
          )}

          {needsAccount && (
            <div className="space-y-3 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {account
                  ? `Signed in as ${account} — leave blank to keep this session, or enter another account.`
                  : "Your account in that project — it scopes the notes to you."}
              </p>
              <Field
                label="Email"
                value={email}
                onChange={setEmail}
                placeholder="you@example.com"
                testId="sync-email"
              />
              <Field
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                testId="sync-password"
              />
            </div>
          )}

          {formError || status === "error" || status === "offline" ? (
            <p
              className="flex items-start gap-2 text-sm text-destructive"
              data-testid="sync-form-error"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{" "}
              {formError || message}
            </p>
          ) : null}

          <DialogFooter className="gap-2 sm:gap-2">
            {editing && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            )}
            {needsAccount && (
              <Button
                type="button"
                variant="outline"
                disabled={busy || !email.trim() || !password}
                onClick={() => void submit("signup")}
              >
                Create account
              </Button>
            )}
            <Button type="submit" disabled={busy} data-testid="sync-connect">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{" "}
              {needsAccount ? "Sign in & connect" : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      )}
    </>
  );
}
