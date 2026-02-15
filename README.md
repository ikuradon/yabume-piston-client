# yabume-piston-client

Nostr bot that executes code via
[Piston API](https://github.com/engineer-man/piston).

## Commands

### /run \<language\>

Execute code in the specified language.

**Basic Syntax:**

````
/run <language>
<args (optional, one per line)>
```
<code>
```
<stdin (optional)>
````

**Legacy Syntax:**

```
/run <language>
<code>
```

### /rerun

Re-execute the referenced `/run` post with optional new args/stdin.

```
/rerun
<args (optional, one per line)>
---
<stdin (optional)>
```

### /run help

Show usage help.

### /run lang

Show supported languages.

## Setup

### Environment Variables

| Variable          | Description               | Default         |
| ----------------- | ------------------------- | --------------- |
| `PISTON_SERVER`   | Piston API server URL     | (required)      |
| `RELAY_URL`       | Nostr relay WebSocket URL | `wss://yabu.me` |
| `PRIVATE_KEY_HEX` | Nostr private key (hex)   | (required)      |

Create a `.env` file or export the variables.

### Run

```bash
deno task start
```

### Test

```bash
deno task test
```

## License

[MIT](LICENSE)
