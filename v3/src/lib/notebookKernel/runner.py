# Cell runner for the Code tab's Pyodide notebook kernel. Loaded once into the
# worker's interpreter (as a ?raw string) and then called per cell.
#
# It reproduces the parts of IPython's execution model that make a notebook a
# notebook, and nothing more:
#   - one persistent namespace, so cell 2 sees what cell 1 defined
#   - the last bare expression is echoed as the result (`df` on its own line)
#   - _repr_html_ is honoured, so a DataFrame renders as a table
#   - open matplotlib figures are captured as inline PNGs (%matplotlib inline)
#
# Returns a JSON string whose "outputs" match the NotebookOutput union in
# src/lib/notebook.ts, so saved outputs and freshly-run outputs render through
# the exact same component.

import ast
import base64
import io
import json
import sys
import traceback

# The namespace cells share. Rebound by reset_namespace() on kernel restart.
__marblo_ns = {"__name__": "__main__"}


def __marblo_reset():
    global __marblo_ns
    __marblo_ns = {"__name__": "__main__"}


# --- Hangul font -----------------------------------------------------------
# Pyodide's matplotlib ships DejaVu Sans and nothing else, so every Korean
# label in a chart comes out as a tofu box. The worker writes a bundled OFL
# font into this filesystem at boot and hands us the path; we register it with
# matplotlib the first time matplotlib is actually loaded.
#
# All of this is best-effort by design: a missing or unreadable font must fall
# back to DejaVu, never stop a cell from running. A chart feature that refuses
# to boot is a worse bug than a chart with tofu in it.
__marblo_font_path = None
__marblo_font_state = "unset"  # unset | pending | applied | unavailable


def __marblo_set_font(path):
    """Called once by the worker after it stages the font file."""
    global __marblo_font_path, __marblo_font_state
    __marblo_font_path = path
    __marblo_font_state = "pending"


def __marblo_apply_font():
    """Make the bundled font matplotlib's default. Idempotent, cheap when done.

    Must run BEFORE the cell body: a Text object snapshots
    rcParams["font.family"] when it is constructed, so applying this after
    plt.title() has already run would be too late to matter.

    Stays a no-op until the matplotlib wheel is on sys.path — importing it
    eagerly would cost seconds on every cell that never plots.
    """
    global __marblo_font_state
    if __marblo_font_state != "pending":
        return
    try:
        import importlib.util

        if importlib.util.find_spec("matplotlib") is None:
            return  # wheel not loaded yet; a later cell will pick it up

        import matplotlib
        from matplotlib import font_manager

        font_manager.fontManager.addfont(__marblo_font_path)
        family = font_manager.FontProperties(fname=__marblo_font_path).get_name()
        # Keep the old list behind it rather than replacing it: the Hangul font
        # covers Latin too, but anything it lacks should still fall back to
        # DejaVu instead of turning into a box.
        matplotlib.rcParams["font.family"] = "sans-serif"
        matplotlib.rcParams["font.sans-serif"] = [family] + [
            name
            for name in matplotlib.rcParams["font.sans-serif"]
            if name != family
        ]
        # Negative ticks: matplotlib draws U+2212 MINUS SIGN by default, which
        # most Korean fonts omit — so fixing Hangul classically re-breaks "-0.05"
        # into a box. The ASCII hyphen is in every font, including whatever the
        # user switches to later.
        matplotlib.rcParams["axes.unicode_minus"] = False
        __marblo_font_state = "applied"
    except Exception:
        # Try once, then stay out of the way. Retrying per cell would spend the
        # same seconds again on a font that is not going to start working.
        __marblo_font_state = "unavailable"


def __marblo_capture_figures(outputs):
    """Drain every open matplotlib figure into a PNG output, then close it.

    Runs only when pyplot was actually imported — importing it eagerly would
    cost seconds on a cell that never plots.
    """
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    for num in plt.get_fignums():
        figure = plt.figure(num)
        # Skip figures with nothing drawn on them (e.g. a bare plt.figure()).
        if not figure.get_axes():
            continue
        buffer = io.BytesIO()
        figure.savefig(buffer, format="png", bbox_inches="tight", dpi=100)
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        outputs.append(
            {
                "kind": "image",
                "mime": "image/png",
                "dataUrl": "data:image/png;base64," + encoded,
            }
        )
    plt.close("all")


def __marblo_result_output(value):
    """Formats a cell's result value the way Jupyter formats Out[n]."""
    if value is None:
        return None
    html = getattr(value, "_repr_html_", None)
    if callable(html):
        try:
            rendered = html()
            if rendered:
                return {"kind": "html", "html": rendered}
        except Exception:
            pass  # fall through to repr — a broken _repr_html_ is not fatal
    try:
        text = repr(value)
    except Exception as exc:
        text = "<repr failed: %s>" % exc
    return {"kind": "text", "text": text, "stream": None}


def __marblo_run(code):
    # Before the redirect below, so nothing this does can leak into the cell's
    # own stdout, and before the cell body, so rcParams are in place by the
    # time the cell constructs its first Text.
    __marblo_apply_font()

    outputs = []
    stdout, stderr = io.StringIO(), io.StringIO()
    error = None
    saved_out, saved_err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = stdout, stderr
    try:
        parsed = ast.parse(code, filename="<cell>", mode="exec")
        body = parsed.body
        # A trailing bare expression is the cell's result; everything before it
        # is plain statements. `df = f()` is NOT an Expr, so it echoes nothing.
        tail = None
        if body and isinstance(body[-1], ast.Expr):
            tail = body.pop()
        if body:
            exec(
                compile(ast.Module(body=body, type_ignores=[]), "<cell>", "exec"),
                __marblo_ns,
            )
        value = None
        if tail is not None:
            value = eval(
                compile(ast.Expression(body=tail.value), "<cell>", "eval"),
                __marblo_ns,
            )
    except BaseException:
        # SystemExit/KeyboardInterrupt included on purpose: a cell that raises
        # them should show the traceback, not silently kill the worker.
        etype, evalue, tb = sys.exc_info()
        # Drop this function's own frame so the traceback starts at the cell.
        frames = traceback.format_exception(etype, evalue, tb)
        error = {
            "kind": "error",
            "ename": etype.__name__,
            "evalue": str(evalue),
            "traceback": "".join(
                [frames[0]] + [f for f in frames[1:] if "__marblo_run" not in f]
            ).rstrip(),
        }
        value = None
    finally:
        sys.stdout, sys.stderr = saved_out, saved_err

    out_text = stdout.getvalue()
    if out_text:
        outputs.append({"kind": "text", "text": out_text, "stream": "stdout"})
    err_text = stderr.getvalue()
    if err_text:
        outputs.append({"kind": "text", "text": err_text, "stream": "stderr"})

    if error is None:
        try:
            __marblo_capture_figures(outputs)
        except Exception as exc:  # plotting must never break the whole cell
            outputs.append(
                {
                    "kind": "text",
                    "text": "matplotlib figure capture failed: %s" % exc,
                    "stream": "stderr",
                }
            )
        result = __marblo_result_output(value)
        if result is not None:
            outputs.append(result)
    else:
        outputs.append(error)

    return json.dumps({"outputs": outputs, "failed": error is not None})
