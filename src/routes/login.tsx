import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { store } from "@/lib/storage";
import { syncToAppsScript } from "@/lib/api";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>) => ({
    redirect: typeof s.redirect === "string" ? s.redirect : "/dashboard",
  }),
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Sign in • Smart Invoice" },
      { name: "description", content: "Sign in to manage invoices, customers and inventory." },
    ],
  }),
});

function LoginPage() {
  const { user, verifyCredentials, login } = useAuth();
  const nav = useNavigate();
  const { redirect } = useSearch({ from: "/login" });
  
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // OTP State
  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [otpInput, setOtpInput] = useState("");
  const [sentOtp, setSentOtp] = useState("");
  const [targetUser, setTargetUser] = useState<any>(null);
  const [targetEmail, setTargetEmail] = useState("");
  const [timer, setTimer] = useState(300); // 5 minutes
  const [resendCooldown, setResendCooldown] = useState(0);

  // OTP Countdown
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (step === "otp" && timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [step, timer]);

  // Resend Cooldown Countdown
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (resendCooldown > 0) {
      interval = setInterval(() => {
        setResendCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [resendCooldown]);

  useEffect(() => {
    if (user) nav({ to: redirect || "/dashboard" });
  }, [user, redirect, nav]);

  const sendOtp = async (email: string) => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setSentOtp(code);
    setTimer(300); // Reset to 5 mins
    setResendCooldown(30); // 30s cooldown
    setLoading(true);

    const appsScriptUrl = store.getSettings().appsScriptUrl || "";
    if (!appsScriptUrl) {
      toast.error("Apps Script URL not configured. Please contact the administrator.");
      setLoading(false);
      return false;
    }

    toast.loading("Sending OTP verification email...", { id: "otp-send" });
    try {
      const res = await syncToAppsScript({
        type: "otp.send",
        payload: { email, otp: code },
      });
      toast.dismiss("otp-send");

      if (res && res.ok) {
        toast.success(`OTP has been sent to ${email}`);
        return true;
      } else {
        toast.error("Failed to send OTP email. Please check your network and try again.");
        return false;
      }
    } catch (error) {
      toast.dismiss("otp-send");
      toast.error("Failed to send OTP email. Please check your network and try again.");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const submitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.error("Please enter both username and password");
      return;
    }
    setLoading(true);

    try {
      const r = await verifyCredentials(username, password);
      if (!r.ok || !r.user || !r.email) {
        toast.error(r.error ?? "Invalid username or password");
        setLoading(false);
        return;
      }

      setTargetUser(r.user);
      setTargetEmail(r.email);

      const sent = await sendOtp(r.email);
      if (sent) {
        setStep("otp");
      }
    } catch (err) {
      console.error(err);
      toast.error("An error occurred during sign in.");
    } finally {
      setLoading(false);
    }
  };

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpInput.trim().length !== 6) {
      toast.error("Please enter the 6-digit OTP code");
      return;
    }
    if (timer <= 0) {
      toast.error("OTP has expired. Please request a new code.");
      return;
    }
    if (otpInput !== sentOtp) {
      toast.error("Incorrect OTP code. Please check your email.");
      return;
    }

    setLoading(true);
    try {
      // Login context session write
      login(targetUser);

      // Restore/pull data
      const appsScriptUrl = store.getSettings().appsScriptUrl || "";
      if (appsScriptUrl.trim()) {
        toast.info("Downloading database from Google Sheets...");
        const res = await syncToAppsScript({
          type: "database.pull",
          payload: { email: targetEmail, otp: otpInput }
        });
        if (res.ok && res.data) {
          const data = res.data;

          if (data.settings) {
            const currentSettings = store.getSettings();
            store.saveSettings({ ...currentSettings, ...data.settings });
          }

          if (Array.isArray(data.customers)) store.saveCustomers(data.customers);
          if (Array.isArray(data.vendors)) store.saveVendors(data.vendors);
          if (Array.isArray(data.products)) store.saveProducts(data.products);
          if (Array.isArray(data.invoices)) store.saveInvoices(data.invoices);
          if (Array.isArray(data.purchaseBills)) store.savePurchaseBills(data.purchaseBills);
          if (Array.isArray(data.expenses)) store.saveExpenses(data.expenses);
          if (Array.isArray(data.payments)) store.savePayments(data.payments);
          if (Array.isArray(data.activityLogs)) store.saveActivityLogs(data.activityLogs);

          toast.success("✅ Cloud database successfully restored!");
        }
      }

      toast.success("Welcome back");
      nav({ to: redirect || "/dashboard" });
    } catch (err) {
      console.error(err);
      toast.error("An error occurred while logging in.");
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins}:${remainingSecs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 px-4">
      <Card className="w-full max-w-md border-slate-200/50 dark:border-slate-800/50 shadow-2xl backdrop-blur-sm bg-white/95 dark:bg-slate-900/95">
        <CardHeader className="space-y-4 pb-6 text-center">
          <div className="mx-auto flex h-32 w-32 items-center justify-center rounded-full bg-white p-2 shadow-sm border border-slate-100">
            <img
              src="https://www.mrsauce.co.uk/public/assets/img/logo.png"
              alt="Mr Sauce Logo"
              className="h-full w-full object-contain"
            />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              Mr Sauce
            </CardTitle>
            <CardDescription className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Billing &amp; Management Portal
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {step === "credentials" ? (
            <form className="space-y-4" onSubmit={submitCredentials}>
              <div className="space-y-1.5">
                <Label htmlFor="u" className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Username
                </Label>
                <Input
                  id="u"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  autoFocus
                  className="h-10 border-slate-200 focus:border-primary focus:ring-1 focus:ring-primary dark:border-slate-800"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p" className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Password
                </Label>
                <Input
                  id="p"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  className="h-10 border-slate-200 focus:border-primary focus:ring-1 focus:ring-primary dark:border-slate-800"
                />
              </div>
              <Button type="submit" className="w-full h-10 mt-2 font-medium transition-all" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {loading ? "Authenticating..." : "Sign in"}
              </Button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={submitOtp}>
              <div className="text-center space-y-1 pb-2">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  We sent a 6-digit OTP code to your registered email:
                </p>
                <p className="font-semibold text-slate-900 dark:text-white">{targetEmail}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="o" className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Enter OTP Code
                </Label>
                <Input
                  id="o"
                  type="text"
                  maxLength={6}
                  placeholder="e.g. 123456"
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ""))}
                  disabled={loading}
                  autoFocus
                  className="h-12 text-center text-xl font-bold tracking-widest border-slate-200 focus:border-primary focus:ring-1 focus:ring-primary dark:border-slate-800"
                />
              </div>
              <div className="flex justify-between items-center text-xs px-1">
                <span className={timer > 0 ? "text-slate-500" : "text-rose-600 font-semibold"}>
                  {timer > 0 ? `Expires in ${formatTime(timer)}` : "OTP Expired"}
                </span>
                <button
                  type="button"
                  onClick={() => sendOtp(targetEmail)}
                  disabled={loading || resendCooldown > 0}
                  className="text-primary font-semibold hover:underline disabled:text-slate-400 disabled:no-underline"
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend OTP"}
                </button>
              </div>
              <Button type="submit" className="w-full h-10 mt-2 font-medium transition-all" disabled={loading || timer <= 0}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {loading ? "Verifying..." : "Verify & Sign in"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setStep("credentials");
                  setOtpInput("");
                  setSentOtp("");
                }}
                disabled={loading}
                className="w-full text-center text-xs text-slate-500 hover:text-slate-950 dark:hover:text-white mt-1 hover:underline transition-all"
              >
                Back to Login
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
