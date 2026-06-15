import { describe, expect, it } from "vitest";
import { detectDangerousCommand } from "../../electron/danger-command";

describe("detectDangerousCommand — dangerous patterns", () => {
  const cases: Array<{
    name: string;
    text: string;
    pattern: string;
    severity: "high" | "medium";
  }> = [
    {
      name: "rm -rf",
      text: "rm -rf /tmp/x",
      pattern: "rm -rf",
      severity: "high",
    },
    {
      name: "rm -fr",
      text: "rm -fr ./build",
      pattern: "rm -rf",
      severity: "high",
    },
    {
      name: "rm -r -f split flags",
      text: "rm -r -f node_modules",
      pattern: "rm -rf",
      severity: "high",
    },
    {
      name: "rm --recursive --force",
      text: "rm --recursive --force dist",
      pattern: "rm -rf",
      severity: "high",
    },
    {
      name: "git push --force",
      text: "git push --force origin main",
      pattern: "git push --force",
      severity: "high",
    },
    {
      name: "git push -f",
      text: "git push -f",
      pattern: "git push --force",
      severity: "high",
    },
    {
      name: "git push --force-with-lease",
      text: "git push --force-with-lease",
      pattern: "git push --force",
      severity: "high",
    },
    {
      name: "npm publish",
      text: "npm publish --access public",
      pattern: "npm publish",
      severity: "high",
    },
    {
      name: "drop table",
      text: "DROP TABLE users;",
      pattern: "drop table",
      severity: "high",
    },
    {
      name: "curl | bash",
      text: "curl -fsSL https://x.sh | bash",
      pattern: "curl | bash",
      severity: "high",
    },
    {
      name: "curl | sudo sh",
      text: "curl https://x.sh | sudo sh",
      pattern: "curl | bash",
      severity: "high",
    },
    {
      name: "mkfs",
      text: "mkfs.ext4 /dev/sda1",
      pattern: "mkfs",
      severity: "high",
    },
    {
      name: "dd of=",
      text: "dd if=/dev/zero of=/dev/sda bs=1M",
      pattern: "dd of=",
      severity: "high",
    },
    {
      name: "vercel --prod",
      text: "vercel deploy --prod",
      pattern: "vercel --prod",
      severity: "medium",
    },
    {
      name: "chmod 777",
      text: "chmod 777 ./script.sh",
      pattern: "chmod 777",
      severity: "medium",
    },
    {
      name: "chmod -R 0777",
      text: "chmod -R 0777 /var/www",
      pattern: "chmod 777",
      severity: "medium",
    },
    {
      name: "sudo",
      text: "sudo apt-get install foo",
      pattern: "sudo",
      severity: "medium",
    },
  ];

  for (const c of cases) {
    it(`detects ${c.name}`, () => {
      const r = detectDangerousCommand(c.text);
      expect(r.matched).toBe(true);
      expect(r.pattern).toBe(c.pattern);
      expect(r.severity).toBe(c.severity);
    });
  }
});

describe("detectDangerousCommand — benign commands (zero false positives)", () => {
  const benign = [
    "git status",
    "git push origin feature/foo",
    "git push -u origin main",
    "rm file.txt",
    "rm -i old.log",
    "rm -v ./tmp.txt",
    "npm test",
    "npm install express",
    "npm run build",
    "ls -la",
    "chmod 644 file.txt",
    "chmod +x run.sh",
    "vercel dev",
    "curl https://api.example.com/data",
    "select * from drop_table_log",
    "echo 'pseudo random'",
    "node dd-helper.js",
    "addr=of=value",
    "",
  ];

  for (const text of benign) {
    it(`does not flag: ${JSON.stringify(text)}`, () => {
      expect(detectDangerousCommand(text).matched).toBe(false);
    });
  }
});

describe("detectDangerousCommand — priority", () => {
  it("returns the high-severity match when both high and medium are present", () => {
    const r = detectDangerousCommand("sudo rm -rf /");
    expect(r.matched).toBe(true);
    expect(r.severity).toBe("high");
    expect(r.pattern).toBe("rm -rf");
  });
});
