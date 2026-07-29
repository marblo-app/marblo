# Troubleshooting

| Symptom                           | Check                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A new build "has no new features" | You may be running an old install — fully quit, reinstall the latest, and confirm the version in About.    |
| Auth popup on every restart       | Re-authenticate the affected CLI; a stale session can be misread as "not signed in."                       |
| Agent stuck / no output           | The orchestrator's watchdog attempts self-heal; you can also reuse or restart the agent from its terminal. |
| Store item won't install          | Confirm the manifest's pinned `source.ref` still resolves and its `permissions` are acceptable.            |

More help: open an [Issue](https://github.com/marblo-app/marblo/issues) or email team@marblo.app.
