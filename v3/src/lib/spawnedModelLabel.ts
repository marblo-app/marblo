/**
 * 에이전트 배지에 쓰는 "구체 모델" 라벨.
 *
 * 왜 필요한가: 목록·보드는 오래도록 벤더(claude/gpt)만 보여줬다. 같은 벤더 안에서
 * fable5 로 띄운 에이전트와 5.6-sol 로 띄운 에이전트가 화면상 완전히 같아 보여서,
 * 모델을 지정해 스폰한 사람이 "정말 그 모델로 떴는지" 를 확인할 방법이 없었다.
 * agent doc 의 `spawnedModel` 은 main 이 CLI 에 실제로 넘긴 argv 를 되읽어 스탬프한
 * 값이라(요청값이 아니라 서빙된 값) 그 확인의 근거가 된다.
 *
 * 스탬프가 없을 수 있는 경우가 둘 있고, 둘 다 정상이다:
 *  - 모델을 핀하지 않은 launch (오케 기본 경로) — argv 에 모델 인자가 없다
 *  - 이 필드가 생기기 전에 만들어진 구 doc
 * 그래서 이 헬퍼는 절대 값을 지어내지 않고 null 을 돌려준다 — 호출부는 배지를
 * 그리지 않고 기존 벤더 표시(모노그램/아이콘)로 graceful fallback 한다.
 */

/** 배지에 그릴 텍스트. 스탬프가 없으면 null(=배지 없음). */
export function spawnedModelLabel(spawnedModel?: string): string | null {
  const trimmed = spawnedModel?.trim();
  return trimmed ? trimmed : null;
}

/**
 * 배지 title(툴팁). 벤더와 구체 모델을 함께 보여줘, 배지가 잘려도(좁은 행)
 * 마우스만 올리면 전체 문자열을 읽을 수 있게 한다.
 */
export function spawnedModelTitle(
  spawnedModel: string,
  model?: string,
): string {
  return model ? `${model} · ${spawnedModel}` : spawnedModel;
}
