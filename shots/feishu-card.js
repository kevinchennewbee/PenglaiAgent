window.PENGLAI_CARD = {
  "config": {
    "wide_screen_mode": true
  },
  "header": {
    "title": {
      "tag": "plain_text",
      "content": "⚠️ L3 审批请求"
    },
    "template": "red"
  },
  "elements": [
    {
      "tag": "div",
      "fields": [
        {
          "is_short": true,
          "text": {
            "tag": "lark_md",
            "content": "**级别**\nL3（l3:outbound）"
          }
        },
        {
          "is_short": true,
          "text": {
            "tag": "lark_md",
            "content": "**任务**\n重写官网 Hero 区块"
          }
        }
      ]
    },
    {
      "tag": "div",
      "text": {
        "tag": "lark_md",
        "content": "**操作**\nbash: git push origin main"
      }
    },
    {
      "tag": "div",
      "text": {
        "tag": "lark_md",
        "content": "**理由**\n任务「重写官网 Hero 区块」已在 jail 内完成并本地验证通过；推送会改变外部状态、不可回退——按审批四级制，这一步必须你点头，决定全程留痕可回放。"
      }
    },
    {
      "tag": "hr"
    },
    {
      "tag": "action",
      "actions": [
        {
          "tag": "button",
          "text": {
            "tag": "plain_text",
            "content": "批准"
          },
          "type": "primary",
          "value": {
            "a": "approve",
            "id": "b3f1c9a2-7e24-4d8b-9c51-2f6a0e8d41c7"
          }
        },
        {
          "tag": "button",
          "text": {
            "tag": "plain_text",
            "content": "拒绝"
          },
          "type": "danger",
          "value": {
            "a": "reject",
            "id": "b3f1c9a2-7e24-4d8b-9c51-2f6a0e8d41c7"
          }
        }
      ]
    },
    {
      "tag": "note",
      "elements": [
        {
          "tag": "plain_text",
          "content": "也可回复：批准 b3f1c9a2 或 拒绝 b3f1c9a2"
        }
      ]
    }
  ]
};
