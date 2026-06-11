import { readFile } from "node:fs/promises";

const checks = [
  {
    name: "Action Envelope contract",
    file: "packages/core/src/interaction/action-envelope.ts",
    patterns: [/ActionEnvelope/, /requestedIntent/, /actionSource/],
  },
  {
    name: "Context compression event",
    file: "packages/studio/src/api/server.ts",
    patterns: [/onContextCompression/, /context:compression/],
  },
  {
    name: "Play transactional render",
    file: "packages/core/src/play/play-runner.ts",
    patterns: [/render/i, /commit/i],
  },
  {
    name: "Play mobile HUD",
    file: "packages/studio/src/components/chat/PlayHud.tsx",
    patterns: [/72dvh/, /safe-area-inset-bottom/],
  },
  {
    name: "Chinese IME composition guard",
    file: "packages/studio/src/pages/ChatPage.tsx",
    patterns: [/useCompositionInput/, /isComposing/, /keyCode\s*!==\s*229/],
  },
  {
    name: "Android runtime capabilities",
    file: "packages/studio/src/api/runtime-routes.ts",
    patterns: [/runtime\/capabilities/, /INKOS_PLAY_ENABLED/, /minimumAndroidApi:\s*28/],
  },
  {
    name: "Android loopback-only cleartext",
    file: "packages/studio/android/app/src/main/res/xml/network_security_config.xml",
    patterns: [/127\.0\.0\.1/, /localhost/],
  },
];

let failed = false;
for (const check of checks) {
  let source = "";
  try {
    source = await readFile(check.file, "utf8");
  } catch {
    console.error(`FAIL ${check.name}: missing ${check.file}`);
    failed = true;
    continue;
  }
  const missing = check.patterns.filter((pattern) => !pattern.test(source));
  if (missing.length > 0) {
    console.error(`FAIL ${check.name}: ${check.file} is missing ${missing.map(String).join(", ")}`);
    failed = true;
  } else {
    console.log(`OK   ${check.name}`);
  }
}

if (failed) process.exitCode = 1;
