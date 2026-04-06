<script lang="ts">
  import { supabaseClient } from '$lib/supabase';
  import type { LessonPlan } from '$lib/models';
  import Fa from 'svelte-fa';
  import { toaster } from '$lib/toast';
  import {
    faEdit,
    faSave,
    faPlus,
    faUpload,
    faFile,
    faDownload,
    faTrash,
    faFileAlt,
    faFileSignature
  } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';

  let { trainingId, date }: { trainingId: string; date: string } = $props();

  let lessonPlan: LessonPlan | null = $state(null);
  let isEditing = $state(false);
  let isLoading = $state(false);
  let isUploading = $state(false);
  let content = $state('');
  let title = $state('');
  let selectedFile: File | null = $state(null);
  let fileInput: HTMLInputElement;
  let tabSet = $state(0); // 0 for text, 1 for file
  let previewUrl: string | null = $state(null);

  async function loadLessonPlan() {
    isLoading = true;
    try {
      const { data, error } = await supabaseClient
        .from('lesson_plans')
        .select('*')
        .eq('trainingId', trainingId)
        .eq('date', date)
        .maybeSingle();

      if (error) {
        console.error('Error loading lesson plan:', error);
        return;
      }

      if (data) {
        lessonPlan = {
          id: data.id,
          trainingId: parseInt(trainingId),
          date: data.date,
          title: data.title || '',
          content: data.content || '',
          fileName: data.file_name,
          filePath: data.file_path,
          fileType: data.file_type,
          fileSize: data.file_size,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
          createdBy: data.created_by
        };
        content = lessonPlan.content || '';
        title = lessonPlan.title || '';

        // Get preview URL if file exists and can be previewed
        if (lessonPlan.filePath && canPreviewFile(lessonPlan.fileType)) {
          previewUrl = await getFilePreviewUrl(lessonPlan.filePath);
        } else {
          previewUrl = null;
        }
      } else {
        // Reset state when no lesson plan exists
        lessonPlan = null;
        content = '';
        title = '';
        selectedFile = null;
        previewUrl = null;
      }
    } finally {
      isLoading = false;
    }
  }

  async function saveLessonPlan() {
    if (tabSet === 1 && !selectedFile && !lessonPlan?.filePath) return;
    if (tabSet === 0 && !content.trim()) return;

    isLoading = true;
    isUploading = true;
    try {
      let filePath = '';
      let fileName = '';
      let fileType = '';
      let fileSize = 0;

      // Handle file upload if file tab is active and a file is selected
      if (tabSet === 1 && selectedFile) {
        const fileExt = selectedFile.name.split('.').pop();
        const timestamp = Date.now();
        fileName = selectedFile.name;
        filePath = `${trainingId}/${date}/${timestamp}.${fileExt}`;
        fileType = selectedFile.type;
        fileSize = selectedFile.size;

        // Upload file to storage
        const { error: uploadError } = await supabaseClient.storage
          .from('lesson-plans')
          .upload(filePath, selectedFile, {
            cacheControl: '3600',
            contentType: selectedFile.type,
            upsert: true
          });

        if (uploadError) {
          console.error('Error uploading file:', uploadError);
          toaster.error({
            title: `${$_('page.trainings.uploadError')}: ${uploadError.message}`
          });
          return;
        }
      }

      // Get current user
      const {
        data: { user }
      } = await supabaseClient.auth.getUser();

      if (lessonPlan) {
        // Update existing - if switching to file or new file uploaded, remove old file
        if (
          (tabSet === 1 && selectedFile && lessonPlan.filePath) ||
          (tabSet === 0 && lessonPlan.filePath)
        ) {
          await supabaseClient.storage.from('lesson-plans').remove([lessonPlan.filePath]);
        }

        const updateData: {
          title: string | null;
          content?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          file_type?: string | null;
          file_size?: number | null;
        } = {
          title: title || null
        };

        if (tabSet === 1 && selectedFile) {
          // New file upload - clear content, set file fields
          updateData.content = null;
          updateData.file_name = fileName;
          updateData.file_path = filePath;
          updateData.file_type = fileType;
          updateData.file_size = fileSize;
        } else if (tabSet === 1 && !selectedFile) {
          // Keep existing file - only update title
        } else {
          // Text content - clear file fields, set content
          updateData.content = content.trim();
          updateData.file_name = null;
          updateData.file_path = null;
          updateData.file_type = null;
          updateData.file_size = null;
        }

        const { data, error } = await supabaseClient
          .from('lesson_plans')
          .update(updateData)
          .eq('id', lessonPlan.id)
          .select()
          .single();

        if (error) {
          console.error('Error updating lesson plan:', error);
          toaster.error({
            title: `${$_('page.trainings.saveError')}: ${error.message}`
          });
          return;
        }

        lessonPlan = {
          ...lessonPlan,
          title: data.title || '',
          content: data.content || '',
          fileName: data.file_name,
          filePath: data.file_path,
          fileType: data.file_type,
          fileSize: data.file_size,
          updatedAt: data.updated_at
        };

        // Update preview URL if file was uploaded
        if (
          tabSet === 1 &&
          selectedFile &&
          lessonPlan.filePath &&
          canPreviewFile(lessonPlan.fileType)
        ) {
          previewUrl = await getFilePreviewUrl(lessonPlan.filePath);
        } else if (tabSet === 0) {
          // Clear preview if switching to text
          previewUrl = null;
        }
      } else {
        // Create new
        const insertData: {
          trainingId: number;
          date: string;
          title: string | null;
          created_by?: string;
          content?: string;
          file_name?: string;
          file_path?: string;
          file_type?: string;
          file_size?: number;
        } = {
          trainingId: parseInt(trainingId),
          date,
          title: title || null,
          created_by: user?.id
        };

        if (tabSet === 1 && selectedFile) {
          // File upload
          insertData.file_name = fileName;
          insertData.file_path = filePath;
          insertData.file_type = fileType;
          insertData.file_size = fileSize;
        } else {
          // Text content
          insertData.content = content.trim();
        }

        const { data, error } = await supabaseClient
          .from('lesson_plans')
          .insert(insertData)
          .select()
          .single();

        if (error) {
          console.error('Error creating lesson plan:', error);
          toaster.error({
            title: `${$_('page.trainings.saveError')}: ${error.message}`
          });
          return;
        }

        lessonPlan = {
          id: data.id,
          trainingId: parseInt(trainingId),
          date: data.date,
          title: data.title || '',
          content: data.content || '',
          fileName: data.file_name,
          filePath: data.file_path,
          fileType: data.file_type,
          fileSize: data.file_size,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
          createdBy: data.created_by
        };

        // Update preview URL if file was uploaded
        if (
          tabSet === 1 &&
          selectedFile &&
          lessonPlan.filePath &&
          canPreviewFile(lessonPlan.fileType)
        ) {
          previewUrl = await getFilePreviewUrl(lessonPlan.filePath);
        } else if (tabSet === 0) {
          // Clear preview if switching to text
          previewUrl = null;
        }
      }

      selectedFile = null;
      isEditing = false;
    } finally {
      isLoading = false;
      isUploading = false;
    }
  }

  function startEditing() {
    if (!lessonPlan) {
      const template = $_('page.trainings.defaultTemplate');
      content = Array.isArray(template) ? template.join('\n') : template;
      title = '';
      tabSet = 0; // Default to text for new lesson plans
    } else {
      // Set tab based on existing content
      tabSet = lessonPlan.filePath ? 1 : 0;
    }
    selectedFile = null;
    isEditing = true;
  }

  function cancelEditing() {
    if (lessonPlan) {
      content = lessonPlan.content || '';
      title = lessonPlan.title || '';
    } else {
      content = '';
      title = '';
    }
    selectedFile = null;
    isEditing = false;
  }

  function handleFileSelect() {
    fileInput.click();
  }

  function onFileSelected(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      selectedFile = target.files[0];
    }
  }

  function removeSelectedFile() {
    selectedFile = null;
    if (fileInput) fileInput.value = '';
  }

  async function downloadFile() {
    if (!lessonPlan?.filePath) return;

    try {
      const { data, error } = await supabaseClient.storage
        .from('lesson-plans')
        .download(lessonPlan.filePath);

      if (error) {
        console.error('Error downloading file:', error);
        return;
      }

      // Create download link
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = lessonPlan.fileName || 'lesson-plan';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading file:', error);
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function canPreviewFile(fileType?: string): boolean {
    if (!fileType) return false;
    return fileType.startsWith('image/') || fileType === 'application/pdf';
  }

  async function getFilePreviewUrl(filePath: string): Promise<string | null> {
    try {
      const { data } = await supabaseClient.storage
        .from('lesson-plans')
        .createSignedUrl(filePath, 60 * 60); // 1 hour expiry

      return data?.signedUrl || null;
    } catch (error) {
      console.error('Error getting preview URL:', error);
      return null;
    }
  }

  // Load lesson plan on component mount and when props change
  $effect(() => {
    if (trainingId && date) {
      loadLessonPlan();
    }
  });
</script>

<div class="card">
  <header class="card-header flex justify-between items-center mb-4">
    <h3 class="h3">{$_('page.trainings.lessonPlanTitle')}</h3>
    <div class="flex gap-2">
      {#if isEditing}
        <button
          class="btn preset-filled-primary-500"
          onclick={saveLessonPlan}
          disabled={isLoading ||
            (tabSet === 0 && !content.trim()) ||
            (tabSet === 1 && !selectedFile && !lessonPlan?.filePath)}
        >
          <Fa icon={faSave} />
          <span>{$_('button.save')}</span>
        </button>
        <button class="btn preset-tonal-surface" onclick={cancelEditing} disabled={isLoading}>
          {$_('button.cancel')}
        </button>
      {:else if lessonPlan}
        <button class="btn preset-tonal-primary" onclick={startEditing} disabled={isLoading}>
          <Fa icon={faEdit} />
          <span>{$_('button.edit')}</span>
        </button>
      {:else}
        <button class="btn preset-filled-primary-500" onclick={startEditing} disabled={isLoading}>
          <Fa icon={faPlus} />
          <span>{$_('page.trainings.createLessonPlan')}</span>
        </button>
      {/if}
    </div>
  </header>

  <section class="card-section px-4">
    <!-- Hidden file input -->
    <input
      type="file"
      bind:this={fileInput}
      onchange={onFileSelected}
      accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.txt"
      style="display: none;"
    />

    {#if isLoading}
      <div class="placeholder animate-pulse">
        <div class="placeholder-circle w-8 h-8"></div>
        <div class="placeholder w-full"></div>
      </div>
    {:else if isEditing}
      <div class="space-y-6">
        <!-- Title input -->
        <label class="label">
          <span>{$_('page.trainings.titleTraining')}</span>
          <input
            class="input"
            type="text"
            placeholder={$_('page.trainings.titlePlaceholder')}
            bind:value={title}
          />
        </label>

        <!-- Tab Group -->
        <div class="flex gap-1">
          <button
            class="btn flex-1 {tabSet === 0 ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
            onclick={() => (tabSet = 0)}
          >
            <Fa icon={faFileSignature} />
            <span>{$_('page.trainings.writeContent')}</span>
          </button>
          <button
            class="btn flex-1 {tabSet === 1 ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
            onclick={() => (tabSet = 1)}
          >
            <Fa icon={faFileAlt} />
            <span>{$_('page.trainings.uploadFile')}</span>
          </button>
        </div>

        <!-- Tab Panels -->
        {#if tabSet === 0}
          <!-- Text content -->
          <div class="space-y-2 mt-4">
            <textarea
              class="textarea"
              rows="12"
              placeholder={$_('page.trainings.contentPlaceholder')}
              bind:value={content}
            ></textarea>
          </div>
        {:else if tabSet === 1}
          <!-- File upload section -->
          <div class="space-y-4 mt-4">
            {#if selectedFile}
              <div class="card preset-tonal-primary p-4">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <Fa icon={faFile} size="lg" />
                    <div>
                      <p class="font-semibold">{selectedFile.name}</p>
                      <p class="text-sm opacity-60">{formatFileSize(selectedFile.size)}</p>
                    </div>
                  </div>
                  <button class="btn preset-tonal-error" onclick={removeSelectedFile}>
                    <Fa icon={faTrash} />
                  </button>
                </div>
              </div>
            {:else}
              <div class="text-center border-2 border-dashed border-surface-300-700 rounded-lg p-8">
                <button
                  class="btn preset-filled-primary-500"
                  onclick={handleFileSelect}
                  disabled={isUploading}
                >
                  <Fa icon={faUpload} />
                  <span>{$_('page.trainings.selectFile')}</span>
                </button>
                <p class="text-sm opacity-60 mt-2">
                  {$_('page.trainings.supportedFormats')}: PDF, Images, Word docs, Text files
                </p>
              </div>
            {/if}
          </div>
        {/if}

        {#if isUploading}
          <div class="text-center py-4">
            <div class="placeholder animate-pulse">
              <div class="placeholder-circle w-6 h-6 mx-auto"></div>
              <p class="mt-2">{$_('page.trainings.uploading')}</p>
            </div>
          </div>
        {/if}
      </div>
    {:else if lessonPlan}
      <div class="space-y-4">
        {#if lessonPlan.title}
          <h4 class="h4">{lessonPlan.title}</h4>
        {/if}

        {#if lessonPlan.filePath}
          <!-- File attachment display -->
          <div class="card preset-tonal-surface p-4">
            <div class="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
              <div class="flex items-center gap-3 min-w-0 flex-1">
                <Fa icon={faFile} size="lg" class="flex-shrink-0" />
                <div class="min-w-0 flex-1">
                  <p class="font-semibold truncate">{lessonPlan.fileName || 'Attachment'}</p>
                  {#if lessonPlan.fileSize}
                    <p class="text-sm opacity-60">{formatFileSize(lessonPlan.fileSize)}</p>
                  {/if}
                </div>
              </div>
              <button
                class="btn preset-tonal-primary flex-shrink-0 w-full sm:w-auto"
                onclick={downloadFile}
              >
                <Fa icon={faDownload} />
                <span>{$_('button.download')}</span>
              </button>
            </div>

            <!-- File Preview -->
            {#if previewUrl && canPreviewFile(lessonPlan.fileType)}
              <div class="border-t border-surface-300-700 pt-4">
                {#if lessonPlan.fileType?.startsWith('image/')}
                  <img
                    src={previewUrl}
                    alt={lessonPlan.fileName || 'Lesson plan attachment'}
                    class="max-w-full h-auto rounded-lg shadow-sm"
                    style="max-height: 400px;"
                  />
                {:else if lessonPlan.fileType === 'application/pdf'}
                  <div class="text-center p-4 bg-surface-100-900 rounded-lg">
                    <iframe
                      src="{previewUrl}#toolbar=0&navpanes=0&scrollbar=0"
                      title="PDF Preview"
                      class="w-full rounded border border-surface-300-700"
                      style="height: 600px;"
                    ></iframe>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {:else if lessonPlan.content}
          <!-- Text content display -->
          <div class="prose max-w-none">
            {#each lessonPlan.content.split('\n') as line}
              {#if line.startsWith('# ')}
                <h1 class="mt-2">{line.slice(2)}</h1>
              {:else if line.startsWith('## ')}
                <h2 class="mt-2">{line.slice(3)}</h2>
              {:else if line.startsWith('### ')}
                <h3 class="mt-2">{line.slice(4)}</h3>
              {:else if line.startsWith('- ')}
                <ul style="list-style: square;" class="px-8"><li>{line.slice(2)}</li></ul>
              {:else}
                <p>{line}</p>
              {/if}
            {/each}
          </div>
        {/if}

        <footer class="text-sm opacity-60">
          {$_('page.trainings.lastEdited')}: {new Date(lessonPlan.updatedAt).toLocaleString()}
        </footer>
      </div>
    {:else}
      <div class="text-center py-8">
        <p class="opacity-60">{$_('page.trainings.noLessonPlanMessage')}</p>
      </div>
    {/if}
  </section>
</div>
