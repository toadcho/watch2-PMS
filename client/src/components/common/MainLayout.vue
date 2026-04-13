<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import AppHeader from './AppHeader.vue'
import AppSidebar from './AppSidebar.vue'

const authStore = useAuthStore()
const drawer = ref(true)

onMounted(() => {
  authStore.restoreFromToken()
})
</script>

<template>
  <div>
    <AppHeader v-model:drawer="drawer" />
    <AppSidebar v-model="drawer" />
    <v-main>
      <v-container fluid class="pa-4">
        <slot />
      </v-container>
    </v-main>
  </div>
</template>
