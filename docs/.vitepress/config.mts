import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "MCP Task Relay",
  description: "Async job execution system with MCP integration",

  base: '/mcp-task-relay/',

  head: [
    ['link', { rel: 'icon', href: '/mcp-task-relay/favicon.ico' }]
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/getting-started' },
      { text: 'API', link: '/api/' },
      {
        text: 'GitHub',
        link: 'https://github.com/royisme/mcp-task-relay'
      }
    ],

    sidebar: {
      '/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is MCP Task Relay?', link: '/' },
            { text: 'Getting Started', link: '/getting-started' },
            { text: 'Core Concepts', link: '/concepts' }
          ]
        },
        {
          text: 'Guide',
          items: [
            { text: 'Usage', link: '/usage' },
            { text: 'Executors', link: '/executors' },
            { text: 'Web UI', link: '/web-ui' },
            { text: 'Testing', link: '/testing' }
          ]
        },
        {
          text: 'Reference',
          items: [
            { text: 'API Reference (Manual)', link: '/api-reference' },
            { text: 'API Reference (Auto)', link: '/api/' }
          ]
        },
        {
          text: 'Development',
          items: [
            { text: 'Contributing', link: '/development' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'API Documentation',
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'Modules', link: '/api/modules' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/royisme/mcp-task-relay' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025 Roy'
    },

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://github.com/royisme/mcp-task-relay/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },

    lastUpdated: {
      text: 'Updated at',
      formatOptions: {
        dateStyle: 'full',
        timeStyle: 'medium'
      }
    }
  },

  locales: {
    root: {
      label: 'English',
      lang: 'en'
    },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '首页', link: '/zh/' },
          { text: '指南', link: '/zh/getting-started' },
          { text: 'API', link: '/api/' },
          {
            text: 'GitHub',
            link: 'https://github.com/royisme/mcp-task-relay'
          }
        ],
        sidebar: {
          '/zh/': [
            {
              text: '介绍',
              items: [
                { text: '什么是 MCP Task Relay?', link: '/zh/' },
                { text: '快速开始', link: '/zh/getting-started' }
              ]
            }
          ]
        },
        editLink: {
          pattern: 'https://github.com/royisme/mcp-task-relay/edit/main/docs/:path',
          text: '在 GitHub 上编辑此页'
        },
        lastUpdated: {
          text: '最后更新于',
          formatOptions: {
            dateStyle: 'full',
            timeStyle: 'medium'
          }
        },
        footer: {
          message: '基于 MIT 许可发布',
          copyright: '版权所有 © 2025 Roy'
        }
      }
    }
  },

  markdown: {
    lineNumbers: true,
    config: (md) => {
      // Mermaid support is built-in to VitePress, no additional config needed
    }
  },

  mermaid: {
    // Mermaid config options
  }
})
