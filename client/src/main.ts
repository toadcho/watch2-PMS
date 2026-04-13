import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import './assets/design-system.css'

import App from './App.vue'
import router from './router'

const vuetify = createVuetify({
  components,
  directives,
  locale: {
    locale: 'ko',
    messages: {
      ko: {
        badge: '{0}개 새 항목',
        input: {
          clear: '지우기',
          prependAction: '{0} 앞 액션',
          appendAction: '{0} 뒤 액션',
        },
        datePicker: {
          title: '날짜 선택',
          header: '날짜 선택',
          input: {
            placeholder: '날짜 입력',
          },
        },
      },
    },
  },
  date: {
    locale: {
      ko: 'ko-KR',
    },
  },
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        colors: {
          primary: '#1976D2',
          secondary: '#455A64',
          accent: '#FF6F00',
          error: '#C62828',
          warning: '#EF6C00',
          info: '#0288D1',
          success: '#2E7D32',
          background: '#FAFBFC',
          surface: '#FFFFFF',
        },
      },
    },
  },
  defaults: {
    VDataTable: {
      density: 'comfortable',
    },
    VBtn: {
      variant: 'flat',
    },
    VTextField: {
      variant: 'outlined',
      density: 'compact',
    },
    VSelect: {
      variant: 'outlined',
      density: 'compact',
    },
    VTextarea: {
      variant: 'outlined',
      density: 'compact',
    },
  },
})

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(vuetify)

app.mount('#app')
