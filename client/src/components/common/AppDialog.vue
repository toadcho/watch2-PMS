<script setup lang="ts">
import { useDialog } from '@/composables/useDialog'

const { visible, title, message, type, color, inputValue, inputLabel, inputType, onOk, onCancel } = useDialog()
</script>

<template>
  <v-dialog v-model="visible" max-width="400" persistent>
    <v-card>
      <v-card-title class="d-flex align-center py-3" style="font-size:14px">
        <v-icon
          start size="small"
          :color="color"
          :icon="type === 'confirm' ? 'mdi-help-circle' : type === 'prompt' ? 'mdi-pencil' : 'mdi-information'"
        />
        {{ title }}
      </v-card-title>
      <v-divider />
      <v-card-text class="py-4" style="font-size:13px; white-space:pre-wrap">
        {{ message }}
        <v-text-field
          v-if="type === 'prompt'"
          v-model="inputValue"
          :label="inputLabel"
          :type="inputType"
          variant="outlined"
          density="compact"
          class="mt-3"
          autofocus
          @keydown.enter="onOk"
        />
      </v-card-text>
      <v-divider />
      <v-card-actions class="px-4 py-2">
        <v-spacer />
        <v-btn v-if="type !== 'alert'" variant="text" size="small" @click="onCancel">취소</v-btn>
        <v-btn :color="color" variant="tonal" size="small" @click="onOk">확인</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
