export function setupInspectorPanel() {
  const panel = document.querySelector("#transaction-inspector"),
    workspace = document.querySelector(".workspace");
  const header = panel.querySelector(".inspector-titlebar"),
    resize = panel.querySelector(".inspector-resize");
  const float = panel.querySelector("#inspector-float"),
    full = panel.querySelector("#inspector-full");
  const dockResize = panel.querySelector(".inspector-divider");
  const toggle = document.querySelector("#inspector-toggle"),
    hide = panel.querySelector("#inspector-hide");
  let mode = "docked",
    previous = "docked",
    lastVisible = "docked",
    drag = null;
  const clamp = (value, min, max) =>
    Math.max(min, Math.min(value, Math.max(min, max)));
  const minWidth = () => Math.min(320, innerWidth - 12),
    minHeight = () => Math.min(220, innerHeight - 12);
  let rect = {
    x: Math.max(6, innerWidth - 680),
    y: 50,
    width: Math.min(660, innerWidth - 12),
    height: Math.min(740, innerHeight - 62),
  };
  function applyRect() {
    rect.width = clamp(rect.width, minWidth(), innerWidth - 12);
    rect.height = clamp(rect.height, minHeight(), innerHeight - 12);
    rect.x = clamp(rect.x, 6, innerWidth - rect.width - 6);
    rect.y = clamp(rect.y, 6, innerHeight - rect.height - 6);
    for (const [key, css] of [
      ["x", "left"],
      ["y", "top"],
      ["width", "width"],
      ["height", "height"],
    ])
      panel.style.setProperty(css, rect[key] + "px");
  }
  function setMode(next) {
    mode = next;
    panel.dataset.mode = mode;
    panel.hidden = mode === "hidden";
    workspace.dataset.inspectorMode = mode;
    toggle.textContent =
      mode === "hidden" ? "Show inspector" : "Hide inspector";
    toggle.setAttribute("aria-expanded", String(mode !== "hidden"));
    panel.style.cssText = "";
    if (mode === "floating") applyRect();
    float.textContent = mode === "docked" ? "Float" : "Dock";
    full.textContent = mode === "full" ? "Restore" : "Full screen";
    full.setAttribute("aria-pressed", String(mode === "full"));
    header.title =
      mode === "full" ? "Transaction inspector" : "Drag to move the inspector";
    document.body.classList.toggle("inspector-full", mode === "full");
    for (const element of document.querySelectorAll(
      ".topbar,.palette,.composer",
    ))
      element.inert = mode === "full";
    if (mode === "full") full.focus();
  }
  function toggleVisibility() {
    if (mode === "hidden") {
      setMode(lastVisible);
      if (mode !== "full") hide.focus();
    } else {
      lastVisible = mode;
      stop();
      setMode("hidden");
      toggle.focus();
    }
  }
  hide.onclick = toggleVisibility;
  toggle.onclick = toggleVisibility;
  float.onclick = () => setMode(mode === "docked" ? "floating" : "docked");
  full.onclick = () => {
    if (mode === "full") setMode(previous);
    else {
      previous = mode;
      setMode("full");
    }
  };
  header.ondblclick = (event) => {
    if (!event.target.closest("button")) full.click();
  };
  function start(event, kind) {
    if (
      event.button !== 0 ||
      (kind === "move" && event.target.closest("button"))
    )
      return;
    if (kind === "move" && mode === "full") return;
    const bounds = panel.getBoundingClientRect();
    if (kind === "move" && mode === "docked") {
      rect = {
        x: Math.min(bounds.left, innerWidth - 660),
        y: clamp(event.clientY - 16, 6, innerHeight - 240),
        width: Math.min(660, innerWidth - 12),
        height: Math.min(740, innerHeight - 12),
      };
      setMode("floating");
    }
    drag = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      rect: { ...rect },
      dockWidth: bounds.width,
      target: event.currentTarget,
    };
    drag.target.setPointerCapture(event.pointerId);
    document.body.classList.add("inspector-dragging");
    event.preventDefault();
  }
  function move(event) {
    if (!drag) return;
    const dx = event.clientX - drag.startX,
      dy = event.clientY - drag.startY;
    if (drag.kind === "dock") {
      const width = clamp(
        drag.dockWidth - dx,
        280,
        Math.max(280, innerWidth - 580),
      );
      workspace.style.setProperty("--inspector-width", width + "px");
      dockResize.setAttribute("aria-valuenow", String(Math.round(width)));
      return;
    }
    if (drag.kind === "move")
      rect = { ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy };
    else
      rect = {
        ...drag.rect,
        width: drag.rect.width + dx,
        height: drag.rect.height + dy,
      };
    applyRect();
  }
  function stop() {
    drag = null;
    document.body.classList.remove("inspector-dragging");
  }
  for (const [element, kind] of [
    [header, "move"],
    [resize, "resize"],
    [dockResize, "dock"],
  ]) {
    element.addEventListener("pointerdown", (event) => start(event, kind));
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
    element.addEventListener("lostpointercapture", stop);
  }
  dockResize.onkeydown = (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const width = clamp(
      panel.getBoundingClientRect().width +
        (event.key === "ArrowLeft" ? 20 : -20),
      280,
      Math.max(280, innerWidth - 580),
    );
    workspace.style.setProperty("--inspector-width", width + "px");
    dockResize.setAttribute("aria-valuenow", String(Math.round(width)));
    event.preventDefault();
  };
  resize.onkeydown = (event) => {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    if (event.key === "ArrowLeft") rect.width -= 20;
    if (event.key === "ArrowRight") rect.width += 20;
    if (event.key === "ArrowUp") rect.height -= 20;
    if (event.key === "ArrowDown") rect.height += 20;
    applyRect();
    event.preventDefault();
  };
  header.onkeydown = (event) => {
    if (
      event.target !== header ||
      mode !== "floating" ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    if (event.key === "ArrowLeft") rect.x -= 20;
    if (event.key === "ArrowRight") rect.x += 20;
    if (event.key === "ArrowUp") rect.y -= 20;
    if (event.key === "ArrowDown") rect.y += 20;
    applyRect();
    event.preventDefault();
  };
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mode === "full") setMode(previous);
  });
  addEventListener("resize", () => {
    if (mode === "floating") applyRect();
  });
  setMode("docked");
}
