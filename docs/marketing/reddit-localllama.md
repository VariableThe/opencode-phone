# r/LocalLLaMA — copy-paste ready

> **Subreddit:** r/LocalLLaMA (~500k+ members, very active, technically sharp)
> **Flair:** `Resources` or `Other` (this sub uses topic flairs, not "Project"; `Resources` fits a tool release best). If a `Tutorial`/`News` flair fits a future post, save those for the follow-up.
> **Rules that matter here:** This community is allergic to cloud-first / closed products and to thin hype. Lead with the **bring-your-own / local-model** angle — emphasize that all inference stays on the user's hardware and the app is just a UI. No marketing voice; be a builder talking to builders. End with a real technical question to invite discussion (mods and users reward that, and it boosts comment count → ranking).
> **Best time:** US daytime, but this sub is global and active late — 9am–1pm ET is safe.
> `{{PLAY_URL}}` = `https://play.google.com/store/apps/details?id=cc.agentlabs.opencode` once approved.
> **Sequencing:** Post this on a DIFFERENT day from r/selfhosted to avoid cross-post spam perception.

---

**Title:**

```
I built an Android app to control opencode from my phone — works with local LLMs via your existing opencode server config
```

**Body:**

If you run [opencode](https://github.com/sst/opencode) with a local model (ollama, LM Studio, llama.cpp server, or any OpenAI-compatible endpoint), OpenCode Mobile gives you a real mobile client for those sessions.

**The setup**

opencode supports any OpenAI-compatible API via its provider config. Point it at your local model, run `opencode serve`, and the app connects over Tailscale / local network / tunnel. All inference stays on your hardware — the app is purely a UI. No keys, no prompts, and no model traffic ever go anywhere but between your phone and your box.

**What you get on the phone**

- Streaming output as your local model generates (token by token via SSE)
- Inline diff viewer — see exactly what the agent is changing before approving
- Tool-call approval UI — explicitly OK file writes and shell commands
- Works with any model opencode supports: local LLMs, Claude, GPT, Gemini, or mixed
- MIT licensed, biometric unlock, secrets in the Android Keystore

**Source / install**

- Source (MIT): https://github.com/dzianisv/opencode-mobile
- Install (F-Droid + APK, one page): https://dzianisv.github.io/opencode-mobile/download/
- All install options + guide: https://dzianisv.github.io/opencode-mobile/
- F-Droid repo: https://dzianisv.github.io/opencode-mobile/fdroid/repo
- Direct APK: https://github.com/dzianisv/opencode-mobile/releases/latest
- Google Play: in review, live shortly — {{PLAY_URL}}

I'm especially interested in feedback from people running local models: how does the streaming UI feel when tokens arrive at 3–5 tok/s on slower hardware? The renderer has a minimum repaint interval to avoid thrashing and I'm not sure the threshold is right for slow generation. Also curious which local backends people are pairing with opencode.
