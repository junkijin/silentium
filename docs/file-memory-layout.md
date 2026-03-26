# File Memory Layout

## 기본 경로

메모리 저장소 루트는 기본적으로 `${XDG_DATA_HOME:-~/.local/share}/silentium/memory/`입니다. 다른 루트를 쓰는 경우에도 내부 구조는 동일합니다.

## 파일 구조

- `events.jsonl`
  - 모든 상태 변경 이벤트를 append-only로 기록합니다.
  - 복구 시 단일 진실 원천으로 사용됩니다.
- `memories/{id}.json`
  - 현재 활성 스냅샷을 저장합니다.
  - `active`, `forgotten`, `superseded` 상태 메모리가 위치합니다.
- `archive/{id}.json`
  - `archived` 상태 메모리를 저장합니다.
- `index/by-type/{type}.json`
  - 타입별 메모리 ID 목록입니다.
- `index/by-subject/{subject}.json`
  - 정규화된 subject 기준 메모리 ID 목록입니다.
- `index/by-status/{status}.json`
  - 상태별 메모리 ID 목록입니다.
- `index/inverted.json`
  - 토큰에서 메모리 ID 목록으로 가는 inverted index입니다.
- `index/recent.json`
  - 최신 수정 순 메모리 ID 목록입니다.
- `index/high-importance.json`
  - 중요도 우선 메모리 ID 목록입니다.
- `stats.json`
  - 전체 메모리 수, 타입별 개수, 상태별 개수, 평균 강도를 저장합니다.

## 재생성 규약

`memories/`, `archive/`, `index/`, `stats.json`은 모두 `events.jsonl`에서 재생성 가능합니다.
