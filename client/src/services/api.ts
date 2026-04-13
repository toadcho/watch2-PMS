import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor: JWT 토큰 주입
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor: 토큰 갱신 및 에러 처리
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      try {
        const refreshToken = localStorage.getItem('refreshToken')
        if (refreshToken) {
          const { data } = await axios.post('/api/v1/auth/refresh', { refreshToken })
          if (data.success) {
            localStorage.setItem('token', data.data.token)
            originalRequest.headers.Authorization = `Bearer ${data.data.token}`
            return api(originalRequest)
          }
        }
      } catch {
        // Refresh failed
      }

      localStorage.removeItem('token')
      localStorage.removeItem('refreshToken')
      window.location.href = '/login'
    }

    return Promise.reject(error)
  }
)

export default api
