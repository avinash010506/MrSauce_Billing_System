import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { onStoreChange, store } from "@/lib/storage";
import { Search, Activity as ActivityIcon } from "lucide-react";

export const Route = createFileRoute("/_app/activity")({
  beforeLoad: () => {
    const s = store.getSession();
    if (!s || s.role !== "admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: ActivityPage,
  head: () => ({ meta: [{ title: "Activity Log • Smart Invoice" }] }),
});

function ActivityPage() {
  const [tick, setTick] = useState(0);
  useEffect(() => onStoreChange(() => setTick((t) => t + 1)), []);
  const [q, setQ] = useState("");

  const logs = useMemo(() => {
    const list = store.activityLogs();
    if (!q.trim()) return list;
    const s = q.toLowerCase();
    return list.filter(
      (l) =>
        l.entityName.toLowerCase().includes(s) ||
        l.actionType.toLowerCase().includes(s) ||
        l.user.toLowerCase().includes(s),
    );
  }, [q, tick]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search activity by entity, action, user…"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <ActivityIcon className="h-10 w-10 opacity-30" />
                      <span>No activity logged yet.</span>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-sm">
                    {new Date(log.timestamp).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-medium">{log.user}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{log.actionType}</Badge>
                  </TableCell>
                  <TableCell>{log.entityName}</TableCell>
                  <TableCell>{log.referenceId || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={log.status === "Success" ? "default" : "secondary"}>
                      {log.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
