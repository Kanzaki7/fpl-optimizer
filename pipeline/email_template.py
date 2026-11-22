"""
E-mail des transferts conseillés : HTML compatible messageries (tableaux,
styles en ligne) dans le style Dossier, et version texte.
"""

from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo

INK, INK2, INK3, LINE, BG, SURFACE = "#0e1013", "#5c6270", "#8a909b", "#dfe1e4", "#f5f6f7", "#ffffff"
ACCENT, GOOD, BAD = "#ff4a17", "#3f7a4c", "#b42318"
MONO = "'IBM Plex Mono',Menlo,Consolas,'Courier New',monospace"
SANS = "'IBM Plex Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"

JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
        "septembre", "octobre", "novembre", "décembre"]


def fr_num(v, d=1):
    return f"{v:.{d}f}".replace(".", ",")


def signed(v):
    return ("+" if v > 0 else "−" if v < 0 else "") + fr_num(abs(v))


def money(v):
    return f"£{fr_num(v)}m"


def deadline_fr(iso):
    d = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ZoneInfo("Europe/Brussels"))
    return f"{JOURS[d.weekday()]} {d.day} {MOIS[d.month - 1]} à {d.hour} h {d.minute:02d}"


def _label(text, color=INK3):
    return (f'<span style="font:500 10px/1 {MONO};letter-spacing:.08em;text-transform:uppercase;'
            f'color:{color}">{escape(text)}</span>')


def _player(p, value, color=INK):
    return (f'<div style="font:600 13px/1.3 {MONO};text-transform:uppercase;color:{color}">{escape(p["name"])}</div>'
            f'<div style="font:400 11px/1.4 {MONO};color:{INK3}">{escape(p["team"])} · {money(p["price"])} · '
            f'{fr_num(value)} pts</div>')


def render(ctx):
    """
    ctx : gw, deadline (ISO), team_name, transfers [(out, in, out_v, in_v)],
          keep, with_, hits, gain, captain, vice, watch [(player, texte)], ft,
          horizon (texte), app_url, unsubscribe_url
    Renvoie (objet, html, texte).
    """
    gw, moves = ctx["gw"], ctx["transfers"]
    when = deadline_fr(ctx["deadline"]) if ctx.get("deadline") else ""
    if moves:
        subject = (f"J{gw} : {len(moves)} transfert{'s' if len(moves) > 1 else ''} conseillé"
                   f"{'s' if len(moves) > 1 else ''} ({signed(ctx['gain'])} pts)")
    else:
        subject = f"J{gw} : gardez votre équipe"

    # --- transferts
    if moves:
        rows = ""
        for out, inn, ov, iv in moves:
            rows += (
                f'<tr><td style="padding:12px 0;border-top:1px solid {LINE};vertical-align:top;width:44%">'
                f'{_label("Vendre", BAD)}{_player(out, ov, BAD)}</td>'
                f'<td style="padding:12px 6px;border-top:1px solid {LINE};vertical-align:middle;'
                f'font:500 14px {MONO};color:{ACCENT}">→</td>'
                f'<td style="padding:12px 0;border-top:1px solid {LINE};vertical-align:top">'
                f'{_label("Acheter", ACCENT)}{_player(inn, iv)}</td>'
                f'<td style="padding:12px 0;border-top:1px solid {LINE};vertical-align:middle;text-align:right;'
                f'font:600 13px {MONO};color:{GOOD};white-space:nowrap">{signed(iv - ov)}</td></tr>')
        moves_html = f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>'
    else:
        reste = f" et reportez vos transferts gratuits ({ctx['ft']})" if ctx["ft"] else ""
        moves_html = (f'<p style="margin:8px 0 0;font:15px/1.5 {SANS};color:{INK2}">Aucun transfert ne rapporte '
                      f'assez cette semaine : gardez votre équipe{reste}.</p>')

    def line(k, v, bold=False):
        w = "600" if bold else "400"
        return (f'<tr><td style="padding:3px 0;font:{w} 13px {SANS};color:{INK if bold else INK2}">{k}</td>'
                f'<td style="padding:3px 0;text-align:right;font:{w} 13px {MONO};color:{INK}">{v}</td></tr>')

    summary = line("Équipe actuelle", f"{fr_num(ctx['keep'])} pts")
    summary += line("Avec ces transferts", f"{fr_num(ctx['with_'])} pts")
    if ctx["hits"]:
        summary += line(f"Pénalité ({ctx['hits']} × 4)", f"−{4 * ctx['hits']} pts")
    summary += line("Gain net", f"{signed(ctx['gain'])} pts", bold=True)

    watch = ""
    if ctx["watch"]:
        items = "".join(
            f'<li style="margin:4px 0;font:13px/1.45 {SANS};color:{INK2}"><b style="font:600 12px {MONO};'
            f'color:{INK};text-transform:uppercase">{escape(p["name"])}</b> · {escape(t)}</li>'
            for p, t in ctx["watch"])
        watch = (f'<tr><td style="padding:22px 24px 0">{_label("À surveiller")}'
                 f'<ul style="margin:8px 0 0;padding-left:18px">{items}</ul></td></tr>')

    html = f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>{escape(subject)}</title></head>
<body style="margin:0;padding:0;background:{BG}">
<div style="display:none;max-height:0;overflow:hidden">{escape(subject)} · date limite {escape(when)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{BG}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:{SURFACE};border:1px solid {LINE}">
  <tr><td style="padding:18px 24px;border-bottom:1px solid {LINE};border-top:3px solid {ACCENT}">
    <span style="font:600 13px {MONO};letter-spacing:.08em;color:{INK}">FPL <span style="color:{INK3}">/</span> OPTIMIZER</span>
  </td></tr>
  <tr><td style="padding:24px 24px 0">
    {_label(f"Journée {gw} · date limite {when}", ACCENT)}
    <h1 style="margin:8px 0 4px;font:500 22px/1.25 {MONO};text-transform:uppercase;color:{INK}">À faire avant la journée {gw}</h1>
    <p style="margin:0;font:14px/1.5 {SANS};color:{INK2}">{escape(ctx['team_name'])} · points attendus sur {escape(ctx['horizon'])}</p>
  </td></tr>
  <tr><td style="padding:20px 24px 0">{_label("1 · Transferts")}{moves_html}</td></tr>
  <tr><td style="padding:20px 24px 0">{_label("2 · Brassard")}
    <p style="margin:8px 0 0;font:600 14px {MONO};text-transform:uppercase;color:{INK}">
      <span style="display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:9px;background:{ACCENT};color:#fff;font-size:10px">C</span>
      {escape(ctx['captain'])} <span style="font-weight:400;color:{INK3};text-transform:none">· vice {escape(ctx['vice'])}</span></p>
  </td></tr>
  <tr><td style="padding:20px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="background:{BG};border:1px solid {LINE};padding:10px 14px">{summary}</table></td></tr>
  {watch}
  <tr><td style="padding:26px 24px 6px" align="left">
    <a href="{escape(ctx['app_url'])}" style="display:inline-block;padding:12px 18px;background:{INK};color:#fff;
      font:500 12px {MONO};letter-spacing:.08em;text-transform:uppercase;text-decoration:none">Ouvrir dans l'éditeur</a>
  </td></tr>
  <tr><td style="padding:16px 24px 24px;font:12px/1.6 {SANS};color:{INK3}">
    Rien n'est modifié sur votre compte FPL : validez vos transferts dans l'application.
    Onze avec capitaine doublé, plus un quart du banc ; prix de revente estimés au prix actuel.
  </td></tr>
</table>
<p style="max-width:600px;margin:14px auto 0;font:11.5px/1.6 {SANS};color:{INK3}">
  Vous recevez cet e-mail parce que vous avez demandé les alertes de FPL Optimizer.
  <a href="{escape(ctx['unsubscribe_url'])}" style="color:{INK2}">Se désinscrire</a>
</p>
</td></tr></table></body></html>"""

    text = [f"À FAIRE AVANT LA JOURNÉE {gw} (date limite {when})", ctx["team_name"], ""]
    if moves:
        text += [f"- Vendre {o['name']} ({money(o['price'])}) -> acheter {i['name']} ({money(i['price'])}) : "
                 f"{signed(iv - ov)} pts" for o, i, ov, iv in moves]
    else:
        text.append("Aucun transfert conseillé : gardez votre équipe.")
    text += ["", f"Capitaine : {ctx['captain']} (vice {ctx['vice']})",
             f"Équipe actuelle {fr_num(ctx['keep'])} pts, avec ces transferts {fr_num(ctx['with_'])} pts, "
             f"gain net {signed(ctx['gain'])} pts ({ctx['horizon']}).", "",
             f"Ouvrir dans l'éditeur : {ctx['app_url']}",
             f"Se désinscrire : {ctx['unsubscribe_url']}"]
    return subject, html, "\n".join(text)
