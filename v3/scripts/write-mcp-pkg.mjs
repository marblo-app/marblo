#!/usr/bin/env node
/*
 * dist-mcp/package.json 생성 (크로스플랫폼).
 * 기존 build:mcp 는 `echo '{"type":"module"}' > dist-mcp/package.json` 였으나
 * 윈도우 cmd 는 작은따옴표를 벗기지 않아 파일에 따옴표가 그대로 박혀 깨진 JSON
 * 이 됐다. 셸 echo 대신 node fs 로 직접 쓴다.
 */
import { writeFileSync } from "node:fs";

writeFileSync(new URL("../dist-mcp/package.json", import.meta.url), '{"type":"module"}\n');
