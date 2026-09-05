# Fractera AI Chat

**The second front door into a Fractera project.** The first is the site your visitors see; this one
is a conversation with the project itself — same account, same files, same server.

It runs as the eighth service of a Fractera deployment: `chat.<your-domain>`, port `3600`, installed
automatically when your server is born. You do not deploy this repository yourself — Fractera clones
it onto your machine.

---

## What it actually adds

A Fractera server already gives you a site, a control panel, a data layer, sign-in, a Telegram bot
and an agent that writes your code. What it did not have was a place to **talk to all of that in
plain words** — to ask what the server is doing, hand it a photo or a voice note, and get an answer
that knows your project rather than the internet in general.

That is what this is. Three things make it different from any chat template you could deploy:

**1. It is the same person you already are.** There is no account here. Sign in once — on the site,
in the panel, or here — and every service sees the same identity and the same role. Sign in as an
architect on your site, and the chat knows you as an architect. This is a requirement of the
product, not a configuration choice: one door, one truth about who you are.

**2. Your files stay yours.** Anything you attach — an image, a voice recording, a video, a
document — lands in **your project's own media library**, on your own server, in the same warehouse
the Telegram bot fills. A receipt photographed into the bot and a picture dropped into the chat sit
next to each other, because "all the files of this project" has to be one answer, not three lists in
three services. Files are served through the project's own route, so the storage key never reaches
a browser.

**3. Voice stays voice.** A recording is transcribed for you, but it is **kept as an attachment**,
not replaced by its text. Intonation, pauses and corrections survive, and you can play the recording
back where it was said.

---

## How it is wired into the server

| Concern | How it works here |
|---|---|
| **Sign-in** | delegated to the Fractera auth service on `:3001` — the same pipeline the panel uses. This app has no sign-in of its own and no guest mode |
| **Storage** | its own PostgreSQL database on your server, created and migrated by the build |
| **Files** | the project's media library on `:3300`, served back through `/api/fractera/media/<id>` |
| **Models** | your OpenAI key, read from the project's own environment file — one key, shared by the project, the data layer and the knowledge graph |
| **Address** | `chat.<domain>` behind nginx with a certificate, issued together with `auth.`, `admin.` and `data.` |

The build itself creates the schema (`pnpm build` runs the migrations first), so a fresh server
comes up with an empty, correct database and no seed data.

---

## This is vendored code, and that has rules

The engine is [`vercel/ai-chatbot`](https://github.com/vercel/ai-chatbot), MIT, brought in whole
rather than depended upon. **[`SOURCE.md`](SOURCE.md) is the authority** on where it came from, how
to update it from upstream, and every place where we deliberately diverge — the AI Gateway, Vercel
Blob, Neon and the template's own sign-in are all replaced, and each replacement is explained there
rather than here.

If you are changing this code: put your edits in separate commits with the reason written down.
The next update from upstream is a merge, and an unexplained local change is one that quietly gets
overwritten or quietly kept when it should not be.

---

## Running it on your own machine

This is not a standalone template — it expects a Fractera server next to it. What it needs, at a
minimum, is a PostgreSQL URL, the address of an auth service, and the path to the project's
environment file where the OpenAI key lives. The full list of names is in
[`.env.example`](.env.example); the values that make them work come from your deployment.

```bash
pnpm install
pnpm build   # migrations run first, then the production build
pnpm start   # PORT=3600 in a Fractera deployment
```

For everyday development against a running deployment, `pnpm dev` is enough.

---

## Licence

MIT, inherited from the upstream template — see [`LICENSE`](LICENSE).
Fractera itself: **[fractera.ai](https://www.fractera.ai)**.
