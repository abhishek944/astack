import { View, div, svg } from "gpui-kit";
import { Button, h_flex, v_flex } from "gpui-base";
import { readFile } from "fs/promises";
import { agents, props, readTextFile, run, terminals, theme, watchFolder } from "herdr";

const SESSION = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const TERMINAL = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)?t[0-9a-z]+$/;
const STATUSES = ["active", "blocked", "completed", "cancelled"];
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const number = (value) => Number.isSafeInteger(value) && value >= 0;
const text = (value) => typeof value === "string" && value.trim().length > 0;

function owner(info) {
  const owners = new Set([...info.matchAll(/^[ \t]*owner:[ \t]*(self|delegate)(?=[ \t.,;:\r]|$)/gim)].map((match) => match[1].toLowerCase()));
  return owners.size === 1 ? [...owners][0] : "unassigned";
}

function delegate(todo) {
  if (owner(todo.taskInfo) !== "delegate") return null;
  const links = [...todo.taskInfo.matchAll(/^[ \t]*hc-terminal:[ \t]*([^\r\n]*)$/gim)].map((match) => match[1].trim());
  return links.length > 0 && links.every((link) => TERMINAL.test(link)) && new Set(links).size === 1 ? links[0] : null;
}

function completion(todo) {
  if (todo.status === "completed") return 100;
  return number(todo.completionPercent) && todo.completionPercent < 100 ? todo.completionPercent : null;
}

function progress(todos) {
  const eligible = todos.filter((todo) => todo.status !== "cancelled");
  const values = eligible.map(completion);
  return !values.length || values.includes(null) ? null : Math.floor(values.reduce((a, b) => a + b, 0) / values.length);
}

function elapsed(todo, at) {
  if (owner(todo.taskInfo) === "delegate" && !todo.delegatedTimes?.length) return null;
  if (!number(todo.elapsedMs)) return null;
  let total = todo.elapsedMs + (todo.workingSince === undefined ? 0 : Math.max(0, at - todo.workingSince));
  for (const source of todo.delegatedTimes ?? []) {
    if (!number(source.elapsedMs)) return null;
    total += source.elapsedMs;
  }
  return number(total) ? total : null;
}

function totalTime(todos, at) {
  const values = todos.map((todo) => elapsed(todo, at));
  if (!values.length || values.includes(null)) return null;
  const total = values.reduce((a, b) => a + b, 0);
  return number(total) ? total : null;
}

function duration(ms) {
  if (ms === null) return "—";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return seconds < 60 ? `${seconds}s` : minutes < 60 ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : hours < 1000 ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m` : `${Math.floor(hours / 24)}d`;
}

function validate(value, sessionId) {
  if (!object(value) || value.version !== 1 || value.sessionId !== sessionId || !text(value.cwd) || !number(value.updatedAt)
    || typeof value.agentRunning !== "boolean" || !Array.isArray(value.works) || value.works.length > 100
    || !Array.isArray(value.todos) || value.todos.length > 500) throw new Error("Invalid or mismatched session task snapshot.");
  const works = new Set();
  const tasks = new Set();
  for (const work of value.works) {
    if (!object(work) || !/^W[1-9][0-9]*$/.test(work.workId) || works.has(work.workId) || !text(work.workName) || !text(work.workInfo)) throw new Error("Invalid work in the task snapshot.");
    works.add(work.workId);
  }
  for (const todo of value.todos) {
    if (!object(todo) || !/^T[1-9][0-9]*$/.test(todo.taskId) || tasks.has(todo.taskId) || !works.has(todo.workId)
      || !text(todo.taskName) || !text(todo.taskInfo) || !STATUSES.includes(todo.status)
      || (todo.blockedReason != null && typeof todo.blockedReason !== "string")
      || (todo.workingSince !== undefined && !number(todo.workingSince))
      || (todo.delegatedTimes !== undefined && (!Array.isArray(todo.delegatedTimes) || todo.delegatedTimes.some((source) => !object(source) || (source.elapsedMs !== null && !number(source.elapsedMs)))))) throw new Error("Invalid task in the task snapshot.");
    tasks.add(todo.taskId);
  }
  return value;
}

export default class Tasks extends View {
  init(_props, cx) {
    const binding = props() ?? {};
    this.sessionId = binding.sessionId;
    this.path = binding.snapshot;
    this.terminal = binding.terminal;
    this.selected = null;
    this.expanded = new Set();
    this.collapsed = new Set();
    this.document = null;
    this.error = "";
    this.actionError = "";
    this.closed = false;
    this.loading = false;
    this.bound = false;
    this.width = 800;
    this.handle = cx.focus_handle();
    if (typeof this.sessionId !== "string" || !SESSION.test(this.sessionId)) {
      this.error = "Reopen Tasks from the intended Pi session with /works-panel herdr.";
      return;
    }
    if (typeof this.path !== "string" || !/^(?:\/|[A-Za-z]:[\\/])/.test(this.path) || this.path.includes("\0")) {
      this.error = "Restart Pi, resume this session, then reopen Tasks with /works-panel herdr.";
      return;
    }
    this.bound = true;
    this.directory = this.path.replace(/[\\/][^\\/]+$/, "");
    cx.spawn(async (cx) => {
      await this.reload(cx);
      try {
        while (!this.closed) {
          const changed = await watchFolder(this.directory);
          if (this.closed) return;
          if (changed.some((path) => path.replace(/\\/g, "/") === this.path.replace(/\\/g, "/"))) await this.reload(cx);
        }
      } catch {
        if (!this.closed) { this.error = "Live updates stopped. Reopen Tasks with /works herdr-off then /works herdr-on."; cx.notify(); }
      }
    });
    // A measured clock, not a spinner animation. Offline/saved values never tick.
    cx.timer.every(1000, (cx) => {
      if (this.document?.todos.some((todo) => todo.workingSince !== undefined && this.running(todo))) cx.notify();
    });
  }

  async reload(cx) {
    if (this.closed || !this.bound) return;
    if (this.loading) { this.reloadPending = true; return; }
    this.loading = true;
    try {
      let content;
      try { content = await readTextFile(this.path); }
      catch { content = await readFile(this.path, "utf8"); }
      if (content === null) throw new Error("The session task file is missing. Resume Pi or restore the file.");
      if (content.length > 16 * 1024 * 1024) throw new Error("The task file exceeds 16 MiB.");
      const next = validate(JSON.parse(content), this.sessionId);
      if (this.closed) return;
      this.document = next;
      this.error = "";
      const ids = new Set(next.todos.map((todo) => todo.taskId));
      for (const id of this.expanded) if (!ids.has(id)) this.expanded.delete(id);
      if (!ids.has(this.selected)) this.selected = null;
    } catch (error) {
      this.document = null;
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
      if (!this.closed) {
        cx.notify();
        if (this.reloadPending) { this.reloadPending = false; await this.reload(cx); }
      }
    }
  }

  close() { this.closed = true; }

  linked(todo) {
    const link = delegate(todo);
    return link && terminals().some((terminal) => terminal.address === link && terminal.state === "live") ? link : null;
  }

  running(todo) {
    if (todo.status !== "active") return false;
    const link = this.linked(todo);
    if (link) return agents().some((agent) => agent.address === link && agent.status === "working");
    const source = this.document?.terminalId ?? this.terminal;
    return owner(todo.taskInfo) === "self" && todo.status === "active" && todo.workingSince !== undefined
      && this.document?.agentRunning && this.document.focusedTaskId === todo.taskId
      && terminals().some((terminal) => terminal.address === source && terminal.state === "live")
      && agents().some((agent) => agent.address === source && agent.status === "working");
  }

  at(todo) {
    return todo.workingSince !== undefined && this.running(todo) ? Date.now() : this.document.updatedAt;
  }

  state(todo) {
    return this.running(todo) ? "Running" : todo.status === "blocked" ? "Blocked"
      : todo.status === "completed" ? "Completed" : todo.status === "cancelled" ? "Cancelled" : "Active; not running";
  }

  button(id, label, accessible, callback, t) {
    return Button.new(id).min_w(0).rounded(4).cursor_pointer().text_color(t.foreground)
      .accessibility_label(accessible).tooltip(accessible).tab_stop(true)
      .focus((style) => style.bg(t.selected).text_color(t.accent))
      .on_click((_event, cx) => { cx.stop_propagation(); callback(cx); }).child(label);
  }

  nameButton(id, label, accessible, callback, t) {
    // Constrain the label itself so long names ellipsize at the end, not under the status glyph.
    return this.button(id, div().flex_1().min_w(0).truncate().text_left().child(label), accessible, callback, t)
      .flex().flex_1().min_w(0).items_center().justify_start().overflow_hidden();
  }

  toggleTask(todo, cx) {
    this.selected = todo.taskId;
    if (this.expanded.has(todo.taskId)) this.expanded.delete(todo.taskId);
    else this.expanded.add(todo.taskId);
    cx.notify();
  }

  openAgent(todo, cx) {
    const link = this.linked(todo);
    if (!link) { this.actionError = "The linked agent is no longer available."; cx.notify(); return; }
    try { run("agent.focus", { terminal: link }); this.actionError = ""; }
    catch { this.actionError = "Could not focus the linked agent."; }
    cx.notify();
  }

  visibleInfo(info) {
    return info.split("\n").filter((line) => !/^\s*hc-(terminal|monitor):/i.test(line))
      .map((line) => line.replace(/^\s*owner:\s*(self|delegate)(?=[\s.,;:]|$)[\s.,;:]*/i, "")).join("\n").trim();
  }

  stateMark(todo, t) {
    const state = this.state(todo);
    if (state === "Running") {
      return svg("mods/pi-tasks/spinner.svg").size(11).flex_none().text_color(t.working)
        .spin(900).role("image").accessibility_label(state).tooltip(state);
    }
    const mark = state === "Blocked" ? "!" : state === "Completed" ? "✓" : state === "Cancelled" ? "×" : "○";
    return div().w(11).flex_none().text_size(12).text_center()
      .text_color(state === "Blocked" ? t.blocked : state === "Completed" ? t.done : t.dim)
      .role("image").accessibility_label(state).tooltip(state).child(mark);
  }

  effortDescription(todo, value) {
    if (value === null) {
      if (owner(todo.taskInfo) === "delegate" && !todo.delegatedTimes?.length) return "Unknown effort; delegate measurement has not been imported";
      if (todo.delegatedTimes?.some((report) => report.elapsedMs === null)) return "Unknown effort; an imported delegate report is unmeasured";
      return "Unknown effort; no complete measurement is recorded, not zero";
    }
    const state = this.running(todo) && todo.workingSince !== undefined ? "Running own measurement"
      : todo.status === "completed" || todo.status === "cancelled" ? "Stopped own measurement" : "Saved measurement; not currently running";
    return state + (todo.delegatedTimes?.length ? "; includes imported delegate effort once" : "; own measured effort");
  }

  metric(id, value, label, width, t) {
    return div().id(id).w(width).flex_none().text_right().text_size(11).whitespace_nowrap().text_color(t.muted)
      .role("label").accessibility_label(label + ": " + value).tooltip(label + ": " + value).child(value);
  }

  taskRow(todo, t, columns) {
    const link = this.linked(todo);
    const pct = completion(todo);
    const time = elapsed(todo, this.at(todo));
    const row = h_flex().id("task-" + todo.taskId).h(30).flex_none().min_w(0).px(10).gap(12).items_center().rounded(5)
      .when(this.selected === todo.taskId, (element) => element.bg(t.selected))
      .hover((style) => style.bg(t.hover))
      .child(h_flex().flex_1().min_w(0).pl(this.width < 450 ? 8 : 18).gap(7).items_center()
        .child(div().w(10).h(17).flex_none().border_l(1).border_b(1).border_color(t.input).rounded_bl(4))
        .child(this.stateMark(todo, t))
        .child(this.nameButton("name-" + todo.taskId, todo.taskName,
          todo.taskName + ". " + this.state(todo) + ". " + (this.expanded.has(todo.taskId) ? "Hide description" : "Show description"),
          (cx) => this.toggleTask(todo, cx), t).text_size(this.width < 450 ? 11 : 12.5).font_medium())
        .child(div().flex_none().text_size(this.width < 450 ? 9 : 11).text_color(t.dim).child(todo.taskId))
        .when(Boolean(link), (element) => element.child(this.button("agent-" + todo.taskId, "Agent ↗",
          "Focus existing linked agent for " + todo.taskName, (cx) => this.openAgent(todo, cx), t)
          .flex_none().px(5).h(23).text_size(this.width < 450 ? 9 : 10).border(1).border_color(t.input).text_color(t.accent))))
      .child(this.metric("progress-" + todo.taskId, pct === null ? "—" : pct + "%", "Estimated progress", columns.progress, t))
      .child(this.metric("time-" + todo.taskId, duration(time), this.effortDescription(todo, time), columns.time, t));
    const elements = [row];
    if (this.expanded.has(todo.taskId)) {
      const info = this.visibleInfo(todo.taskInfo);
      const detail = v_flex().id("description-" + todo.taskId).flex_none().min_w(0).ml(this.width < 450 ? 20 : 38)
        .pl(23).pr(10).py(10).gap(8).border_l(1).border_color(t.input).text_size(12).text_color(t.muted);
      if (info) detail.child(div().min_w(0).whitespace_normal().child(info));
      if (todo.status === "blocked" && todo.blockedReason && !info.includes(todo.blockedReason)) {
        detail.child(div().min_w(0).whitespace_normal().text_color(t.blocked).child(todo.blockedReason));
      }
      if (!info && !(todo.status === "blocked" && todo.blockedReason)) detail.child("No description recorded.");
      elements.push(detail);
    }
    return elements;
  }

  render(cx) {
    const t = /** @type {any} */ (theme());
    const columns = this.width < 450 ? { progress: 36, time: 64 } : { progress: 48, time: 83 };
    const root = v_flex().id("pi-tasks-root").size_full().min_w(0).min_h(0).bg(t.background).text_color(t.foreground)
      .text_size(12.5).track_focus(this.handle)
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } });
    if (this.actionError) root.child(div().px(16).py(6).text_size(12).text_color(t.blocked).whitespace_normal().child(this.actionError));
    if (!this.document) {
      return root.child(h_flex().px(16).py(12).gap(8)
        .child(div().flex_1().min_w(0).whitespace_normal().text_color(t.muted).child(this.error || "Loading tasks…")));
    }
    if (this.error) root.child(div().px(16).py(6).text_color(t.blocked).whitespace_normal().child(this.error));
    if (!this.document.works.length) {
      return root.child(h_flex().px(16).py(12).gap(8)
        .child(div().flex_1().min_w(0).whitespace_normal().text_color(t.muted).child("No works or tasks yet.")));
    }
    const list = v_flex().id("pi-task-list").flex_1().min_h(0).min_w(0).overflow_y_scrollbar().px(this.width < 450 ? 10 : 20).pt(22).pb(20);
    for (const [index, work] of [...this.document.works].reverse().entries()) {
      const todos = this.document.todos.filter((todo) => todo.workId === work.workId);
      if (index) list.child(div().h(1).flex_none().my(16).bg(t.border));
      const open = !this.collapsed.has(work.workId);
      const pct = progress(todos);
      const times = todos.map((todo) => elapsed(todo, this.at(todo)));
      const sum = times.length && !times.includes(null) ? times.reduce((a, b) => a + b, 0) : null;
      const total = number(sum) ? sum : null;
      list.child(h_flex().id("work-" + work.workId).h(30).flex_none().min_w(0).px(10).gap(12).items_center()
        .child(h_flex().flex_1().min_w(0).gap(6).items_center()
          .child(this.nameButton("work-name-" + work.workId, work.workName,
            work.workName + ". " + (open ? "Collapse work" : "Expand work"), (cx) => {
              if (this.collapsed.has(work.workId)) this.collapsed.delete(work.workId); else this.collapsed.add(work.workId);
              cx.notify();
            }, t).text_size(this.width < 450 ? 12 : 13).font_semibold())
          .child(div().flex_none().text_size(10).text_color(t.dim).child(work.workId)))
        .child(this.metric("work-progress-" + work.workId, pct === null ? "—" : pct + "%", "Work progress", columns.progress, t))
        .child(this.metric("work-time-" + work.workId, duration(total), total === null ? "Unknown Work effort; a task or report is unmeasured" : "All task effort including cancelled tasks and imported reports once", columns.time, t)));
      if (!open) continue;
      list.child(h_flex().h(25).flex_none().min_w(0).px(10).gap(12).items_center().text_size(10).text_color(t.dim)
        .child(div().flex_1().min_w(0).child("Task"))
        .child(div().w(columns.progress).flex_none().text_right().text_size(this.width < 450 ? 9 : 10).whitespace_nowrap().child("Progress"))
        .child(div().w(columns.time).flex_none().text_right().whitespace_nowrap().child("Effort")));
      for (const todo of todos) list.children(this.taskRow(todo, t, columns));
      if (!todos.length) list.child(div().px(28).py(6).text_color(t.dim).child("No tasks yet."));
    }
    return root.child(list);
  }
}
