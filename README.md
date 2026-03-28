# silentium

`silentium`은 Bun 기반의 파일 메모리 MCP 서버입니다. 표준 입출력(`stdio`)으로 JSON-RPC를 처리하며, 메모리의 진실 원천은 XDG 데이터 디렉터리 아래의 `events.jsonl`입니다.

## 설치

```bash
bun install
```

## 실행

```bash
bun run dev
```

## 테스트

```bash
bun test
```

## 벤치마크

```bash
bun run bench
bun run eval:memory
bun run eval:memory:marathon
bun run eval:memory:hard
bun run eval:memory:adversarial
bun run eval:memory:longrange
```

벤치마크 설계와 최근 측정 결과는 [docs/benchmarks.md](/Users/junkijin/Workspaces/silentium/docs/benchmarks.md)를 참고하면 됩니다.

## 빌드

```bash
bun run build
```

## 복구 및 재빌드

`events.jsonl`로부터 `memories/`, `archive/`, `index/`, `stats.json`을 재구성합니다.

```bash
bun run rebuild
```

## 제공되는 MCP Tools

- `remember`
- `recall`
- `get_memory`
- `list_memories`
- `update_memory`
- `reinforce_memory`
- `forget_memory`

## 제공되는 MCP Resources

- `silentium://memory/stats`
- `silentium://memory/{id}`
- `silentium://memory/type/{type}`

## 데이터 레이아웃

기본 루트는 `${XDG_DATA_HOME:-~/.local/share}/silentium/memory/`입니다.

- `events.jsonl`: append-only 이벤트 로그
- `memories/*.json`: 현재 메모리 스냅샷
- `archive/*.json`: 아카이브된 메모리 스냅샷
- `index/by-type/*.json`
- `index/by-subject/*.json`
- `index/by-status/*.json`
- `index/inverted.json`
- `index/recent.json`
- `index/high-importance.json`
- `stats.json`

세부 레이아웃 설명은 [docs/file-memory-layout.md](/Users/junkijin/Workspaces/silentium/docs/file-memory-layout.md)를 참고하면 됩니다.

## MCP 클라이언트 설정 예시

```json
{
  "mcpServers": {
    "silentium": {
      "command": "bun",
      "args": ["run", "/Users/junkijin/Workspaces/silentium/src/main.ts"]
    }
  }
}
```
