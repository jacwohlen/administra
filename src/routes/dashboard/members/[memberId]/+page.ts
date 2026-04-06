import type { PageLoad } from './$types';
import { error as err } from '@sveltejs/kit';
import type { Member, Badge } from '$lib/models';
import { supabaseClient } from '$lib/supabase';
import { blobToURL } from 'image-resize-compress';
import dayjs from 'dayjs';

export const load = (async ({ params, depends }) => {
  // Register a dependency on this key, so we can invalidate it after edits
  depends('app:member:' + params.memberId);
  const { data: memberData, error: memberError } = await supabaseClient
    .from('members')
    .select()
    .eq('id', params.memberId)
    .single<Member>();

  if (memberError) {
    throw err(404, memberError);
  }
  if (memberData.img && memberData.imgUploaded) {
    memberData.imgUploaded = dayjs(memberData.imgUploaded); // cast to dayjs for easier handling

    const { data: avatarData, error: avatarError } = await supabaseClient.storage
      .from('avatars')
      .download(memberData.id + '_' + memberData.imgUploaded.valueOf() + '.webp');

    if (avatarData) {
      memberData.img = await blobToURL(avatarData);
    }
    if (avatarError) {
      throw err(404, avatarError);
    }
  }

  const { data: badgeData } = await supabaseClient.rpc('get_member_badges', {
    p_member_id: parseInt(params.memberId)
  });

  return { ...memberData, badges: (Array.isArray(badgeData) ? badgeData : []) as Badge[] };
}) satisfies PageLoad;
