# matrix-todo skill（Claude Code 用）

安裝到新機器：

```bash
mkdir -p ~/.claude/skills
cp -R skill ~/.claude/skills/matrix-todo
node ~/.claude/skills/matrix-todo/scripts/login.mjs
```

登入後 refresh token 存在該機器的 **macOS 鑰匙圈**，不會跟著 git 走，
所以每台新機器都要各自登入一次。裡面沒有任何機密。
