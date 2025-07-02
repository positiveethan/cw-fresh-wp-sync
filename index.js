import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';

const rss = 'https://christianityworks.com/wp-content/plugins/bb-rss-mailchimp/feeds/fresh-unbranded.xml';
const WP_API_BASE = process.env.WP_API_URL; // e.g. https://dev.thelight.com.au/wp-json
const WP_USER = process.env.WP_USER;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;

const authHeader = 'Basic ' + Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');

function buildWPUrl(endpoint) {
  const base = WP_API_BASE.endsWith('/') ? WP_API_BASE : WP_API_BASE + '/';
  return base + endpoint.replace(/^\/+/, '');
}

async function fetchRSS() {
  const res = await fetch(rss);
  const xml = await res.text();
  const parsed = await parseStringPromise(xml, { mergeAttrs: true });
  const item = parsed.rss.channel[0].item[0];

  return {
    title: item.title[0],
    link: item.link[0],
    author: item.author?.[0] ?? 'Unknown',
    description: item.description[0],
    pubDate: new Date(item.pubDate[0]).toISOString(),
    imageUrl: item['media:content']?.find(m => m.medium?.[0] === 'image')?.url?.[0],
    categories: item.category || [],
    scriptureReference: item['fresh:scriptureReference']?.[0],
    scriptureQuote: item['fresh:scriptureQuote']?.[0],
  };
}

async function uploadImageToWP(imageUrl) {
  try {
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) throw new Error(`Failed to fetch image: ${imageUrl}`);
    
    const imageBuffer = await imageRes.buffer();
    const fileName = imageUrl.split('/').pop().split('?')[0];

    const uploadRes = await fetch(buildWPUrl('wp/v2/media'), {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Type': imageRes.headers.get('content-type') || 'image/jpeg',
      },
      body: imageBuffer,
    });

    const resText = await uploadRes.text();
    const uploadData = JSON.parse(resText);
    if (!uploadRes.ok) throw new Error(uploadData.message || 'Upload failed');
    return uploadData.id;
  } catch (err) {
    console.error(`❌ Failed to upload image from ${imageUrl}:`, err);
    return null;
  }
}

async function createPost(data, featuredMediaId) {
  const postUrl = buildWPUrl('wp/v2/posts');

  const postRes = await fetch(postUrl, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: data.title,
      content: data.description,
      status: 'publish',
      featured_media: featuredMediaId,
      date: data.pubDate,
      excerpt: data.scriptureQuote,
      categories: [142], // ✅ Add to category ID 142
      meta: {
        scripture_reference: data.scriptureReference,
      },
    }),
  });

  const json = await postRes.json();

  if (!postRes.ok) {
    console.error(`❌ Failed to create post: ${postRes.statusText}`, json);
    throw new Error(`Post creation failed: ${postRes.statusText}`);
  }

  return json;
}

async function main() {
  try {
    console.log('Environment ready:', {
      WP_API_URL: !!process.env.WP_API_URL,
      WP_USER: !!process.env.WP_USER,
      WP_APP_PASSWORD: !!process.env.WP_APP_PASSWORD,
    });

    const item = await fetchRSS();
    console.log('Fetched item:', item.title);

    const mediaId = item.imageUrl ? await uploadImageToWP(item.imageUrl) : null;
    const post = await createPost(item, mediaId);

    console.log('Post created:', post.link);
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
