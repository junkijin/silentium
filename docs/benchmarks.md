# Benchmarks

`silentium`은 장기 기억 MCP의 핵심 경로를 직접 측정하는 로컬 벤치마크를 제공합니다.

## 조사한 외부 벤치마크

1. `LoCoMo`
   매우 긴 대화 세션에서 장기 대화 기억과 시간 추론을 평가합니다.
2. `LongMemEval`
   정보 추출, 멀티세션 추론, 시간 추론, 지식 업데이트, 절제를 포함한 장기 상호작용 기억을 평가합니다.
3. `PerLTQA`
   개인화된 의미 기억과 에피소드 기억을 분류, 검색, 합성하는 QA 벤치마크입니다.

## 로컬 벤치마크 매핑

- `bulk_remember`
  장시간 상호작용에서 기억이 지속적으로 축적되는 상황을 모사합니다.
- `targeted_recall`
  개인화된 장기 기억 집합에서 관련 항목을 검색하고 회상하는 비용을 측정합니다.
- `rebuild_from_events`
  append-only 이벤트 로그만으로 상태를 복구하는 냉시작 비용을 측정합니다.

## 회상 품질 평가

```bash
bun run eval:memory
bun run eval:memory:hard
bun run eval:memory:adversarial
bun run eval:memory:longrange
```

현재 평가는 다음 세 축을 측정합니다.

- `subject_fidelity`
  질의에 등장한 인물이나 엔터티가 `subject` 필드에 정확히 매핑되는지 평가합니다.
- `type_disambiguation`
  자연어 질의 안의 `preference`, `episode` 같은 힌트를 이용해 적절한 메모리 타입을 우선하는지 평가합니다.
- `temporal_recency`
  유사한 기억이 여럿 있을 때 최신 사건이나 최신 선호를 앞에 두는지 평가합니다.

## 하드 장기기억 평가

`LongMemEval`의 어려운 축을 더 직접적으로 반영한 하드 평가도 제공합니다.

- `knowledge_update`
  오래된 표현이 질의와 더 많이 겹치더라도, `now`, `current`, `latest` 의도를 읽고 최신 기억을 우선하는지 평가합니다.
- `multi_hop`
  1-hop 기억에 등장한 엔터티를 따라가 2-hop 기억을 상위 결과에 포함시키는지 평가합니다.
- `temporal_reasoning`
  `after`, `before`, `most recently` 같은 시간 단서를 따라 올바른 사건을 우선하는지 평가합니다.
- `abstention`
  관련 기억이 없을 때 억지로 후보를 내놓지 않는지 평가합니다.

## 실행

```bash
bun run bench
```

환경 변수로 규모를 조정할 수 있습니다.

- `BENCH_SUBJECT_COUNT`
- `BENCH_INGEST_COUNT`
- `BENCH_RECALL_MEMORY_COUNT`
- `BENCH_RECALL_QUERY_COUNT`
- `BENCH_REBUILD_MEMORY_COUNT`

## 2026-03-27 측정 결과

동일한 조건으로 측정했습니다.

```text
BENCH_INGEST_COUNT=40
BENCH_RECALL_MEMORY_COUNT=100
BENCH_RECALL_QUERY_COUNT=24
BENCH_REBUILD_MEMORY_COUNT=80
```

| benchmark | baseline | optimized | improvement |
| --- | ---: | ---: | ---: |
| `bulk_remember` | `49.2498 ms/op` | `4.8110 ms/op` | `10.24x faster` |
| `targeted_recall` | `30.8446 ms/op` | `2.1451 ms/op` | `14.38x faster` |
| `rebuild_from_events` | `1.4499 ms/op` | `0.5693 ms/op` | `2.55x faster` |

## 2026-03-27 회상 품질 결과

| metric | baseline | optimized |
| --- | ---: | ---: |
| `top1` | `66.7% (4/6)` | `100.0% (6/6)` |
| `top3` | `100.0% (6/6)` | `100.0% (6/6)` |

## 2026-03-27 하드 평가 결과

| metric | baseline | optimized |
| --- | ---: | ---: |
| `pass_rate` | `33.3% (2/6)` | `100.0% (6/6)` |

## 2026-03-27 적대적 평가 결과

`MemoryAgentBench`/`MemoryArena`에서 요구하는 `conflict resolution`, `test-time learning`, `constraint bundle retrieval`에 맞춘 적대적 세트입니다.

| metric | baseline | optimized |
| --- | ---: | ---: |
| `pass_rate` | `66.7% (2/3)` | `100.0% (3/3)` |

## 2026-03-27 장거리 평가 결과

`MemoryAgentBench`의 `long-range understanding` 축을 더 강하게 반영한 세트입니다.

| metric | baseline | optimized |
| --- | ---: | ---: |
| `pass_rate` | `0.0% (0/2)` | `100.0% (2/2)` |
