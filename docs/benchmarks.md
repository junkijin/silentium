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
