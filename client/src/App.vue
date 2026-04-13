<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppDialog from '@/components/common/AppDialog.vue'
</script>

<template>
  <v-app>
    <RouterView />
    <AppDialog />
  </v-app>
</template>
