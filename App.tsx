import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type PostStatus = 'draft' | 'publish' | 'pending' | 'private' | 'future';

type Site = {
  id: string;
  name: string;
  url: string;
  userLabel: string;
};

type Credentials = {
  username: string;
  applicationPassword: string;
};

type WpPost = {
  id: number;
  modified: string;
  status: PostStatus;
  title: { raw: string; rendered: string };
  excerpt: { raw: string; rendered: string };
  content: { raw: string; rendered: string };
};

type Route =
  | { name: 'sites' }
  | { name: 'posts'; site: Site; credentials: Credentials }
  | {
      name: 'editor';
      site: Site;
      credentials: Credentials;
      post: WpPost | null;
    };

const colors = {
  primary: '#1F4B99',
  primaryDark: '#173A75',
  accent: '#2F6EDB',
  soft: '#EAF1FF',
  background: '#F5F7FB',
  surface: '#FFFFFF',
  border: '#E3E8F1',
  text: '#172033',
  muted: '#6B7588',
  danger: '#B42318',
  success: '#147A4B',
};

const SITES_KEY = '@wp-manager/sites';
const ACTIVE_KEY = '@wp-manager/active-site';
const credentialKey = (id: string) => `wp-manager-credentials-${id}`;

const normalizeUrl = (value: string) => {
  const url = value.trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(url)) {
    throw new Error('آدرس سایت باید با https:// شروع شود.');
  }
  return url;
};

const stripHtml = (value: string) =>
  value
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const toGutenberg = (value: string) =>
  value
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<!-- wp:paragraph -->\n<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>\n<!-- /wp:paragraph -->`,
    )
    .join('\n\n');

function encodeBase64(value: string): string {
  const binary = unescape(encodeURIComponent(value));
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';

  for (let index = 0; index < binary.length; index += 3) {
    const first = binary.charCodeAt(index);
    const second = binary.charCodeAt(index + 1);
    const third = binary.charCodeAt(index + 2);
    const a = first >> 2;
    const b = ((first & 3) << 4) | (second >> 4);
    let c = ((second & 15) << 2) | (third >> 6);
    let d = third & 63;
    if (Number.isNaN(second)) {
      c = 64;
      d = 64;
    } else if (Number.isNaN(third)) {
      d = 64;
    }
    output +=
      chars.charAt(a) + chars.charAt(b) + chars.charAt(c) + chars.charAt(d);
  }
  return output;
}

class WordPressClient {
  private apiBase: string;
  private authorization: string;

  constructor(site: Site, credentials: Credentials) {
    this.apiBase = `${normalizeUrl(site.url)}/wp-json/wp/v2`;
    this.authorization = `Basic ${encodeBase64(
      `${credentials.username}:${credentials.applicationPassword.replace(/\s+/g, '')}`,
    )}`;
  }

  static async test(url: string, credentials: Credentials) {
    const site: Site = {
      id: 'test',
      name: 'test',
      url: normalizeUrl(url),
      userLabel: '',
    };
    const client = new WordPressClient(site, credentials);
    const user = await client.request<{
      name?: string;
      username?: string;
      slug?: string;
    }>('/users/me?context=edit');
    return {
      host: new URL(site.url).hostname.replace(/^www\./, ''),
      userLabel: user.name || user.username || user.slug || credentials.username,
    };
  }

  async list(search: string, status?: PostStatus) {
    const params = new URLSearchParams({
      context: 'edit',
      per_page: '50',
      orderby: 'modified',
      order: 'desc',
      _fields: 'id,modified,status,title,excerpt,content',
    });
    if (search.trim()) params.set('search', search.trim());
    params.set('status', status || 'publish,draft,pending,private,future');
    return this.request<WpPost[]>(`/posts?${params.toString()}`);
  }

  async save(postId: number | null, input: {
    title: string;
    excerpt: string;
    content: string;
    status: PostStatus;
  }) {
    return this.request<WpPost>(postId ? `/posts/${postId}` : '/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(input),
    });
  }

  async trash(postId: number) {
    await this.request(`/posts/${postId}`, { method: 'DELETE' });
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: this.authorization,
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      const message =
        typeof payload === 'object' &&
        payload !== null &&
        'message' in payload &&
        typeof payload.message === 'string'
          ? stripHtml(payload.message)
          : `خطای وردپرس (${response.status})`;
      throw new Error(message);
    }
    return payload as T;
  }
}

async function readSites(): Promise<Site[]> {
  const raw = await AsyncStorage.getItem(SITES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Site[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveSite(site: Site, credentials: Credentials) {
  const sites = await readSites();
  const next = [...sites.filter((item) => item.id !== site.id), site];
  await Promise.all([
    AsyncStorage.setItem(SITES_KEY, JSON.stringify(next)),
    SecureStore.setItemAsync(credentialKey(site.id), JSON.stringify(credentials)),
  ]);
}

async function readCredentials(siteId: string) {
  const raw = await SecureStore.getItemAsync(credentialKey(siteId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export default function App() {
  const [sites, setSites] = useState<Site[]>([]);
  const [route, setRoute] = useState<Route>({ name: 'sites' });
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [storedSites, activeId] = await Promise.all([
          readSites(),
          AsyncStorage.getItem(ACTIVE_KEY),
        ]);
        setSites(storedSites);
        const active = storedSites.find((site) => site.id === activeId);
        if (active) {
          const credentials = await readCredentials(active.id);
          if (credentials) setRoute({ name: 'posts', site: active, credentials });
        }
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const selectSite = async (site: Site) => {
    const credentials = await readCredentials(site.id);
    if (!credentials) return;
    await AsyncStorage.setItem(ACTIVE_KEY, site.id);
    setRoute({ name: 'posts', site, credentials });
  };

  const removeSite = async (site: Site) => {
    const next = sites.filter((item) => item.id !== site.id);
    await Promise.all([
      AsyncStorage.setItem(SITES_KEY, JSON.stringify(next)),
      SecureStore.deleteItemAsync(credentialKey(site.id)),
    ]);
    setSites(next);
  };

  if (booting) {
    return (
      <SafeAreaView style={styles.loaderScreen}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar
        barStyle={route.name === 'posts' ? 'light-content' : 'dark-content'}
        backgroundColor={
          route.name === 'posts' ? colors.primaryDark : colors.background
        }
      />
      {route.name === 'sites' && (
        <SitesScreen
          sites={sites}
          onSelect={(site) => void selectSite(site)}
          onRemove={(site) => void removeSite(site)}
          onAdded={async (site, credentials) => {
            await saveSite(site, credentials);
            const next = await readSites();
            setSites(next);
            await AsyncStorage.setItem(ACTIVE_KEY, site.id);
            setRoute({ name: 'posts', site, credentials });
          }}
        />
      )}
      {route.name === 'posts' && (
        <PostsScreen
          site={route.site}
          credentials={route.credentials}
          onSwitch={() => setRoute({ name: 'sites' })}
          onEdit={(post) =>
            setRoute({
              name: 'editor',
              site: route.site,
              credentials: route.credentials,
              post,
            })
          }
        />
      )}
      {route.name === 'editor' && (
        <EditorScreen
          site={route.site}
          credentials={route.credentials}
          post={route.post}
          onBack={() =>
            setRoute({
              name: 'posts',
              site: route.site,
              credentials: route.credentials,
            })
          }
        />
      )}
    </View>
  );
}

function SitesScreen(props: {
  sites: Site[];
  onSelect: (site: Site) => void;
  onRemove: (site: Site) => void;
  onAdded: (site: Site, credentials: Credentials) => Promise<void>;
}) {
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!url.trim() || !username.trim() || !password.trim()) {
      Alert.alert('اطلاعات ناقص', 'آدرس سایت، نام کاربری و Application Password الزامی است.');
      return;
    }
    setSaving(true);
    try {
      const credentials = {
        username: username.trim(),
        applicationPassword: password.trim(),
      };
      const info = await WordPressClient.test(url, credentials);
      const site: Site = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim() || info.host,
        url: normalizeUrl(url),
        userLabel: info.userLabel,
      };
      await props.onAdded(site, credentials);
      setVisible(false);
      setName('');
      setUrl('');
      setUsername('');
      setPassword('');
    } catch (error) {
      Alert.alert('اتصال برقرار نشد', error instanceof Error ? error.message : 'خطای ناشناخته');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.hero}>
          <Text style={styles.heroCaption}>WORDPRESS ARTICLES</Text>
          <Text style={styles.heroTitle}>سایت‌های من</Text>
          <Text style={styles.heroText}>
            چند سایت وردپرسی را متصل کنید و فقط مقالات هر سایت را مدیریت کنید.
          </Text>
        </View>
        <Pressable style={styles.primaryButton} onPress={() => setVisible(true)}>
          <Text style={styles.primaryButtonText}>+ افزودن سایت</Text>
        </Pressable>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>سایت‌های متصل</Text>
          <Text style={styles.countBadge}>{props.sites.length}</Text>
        </View>
        {props.sites.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>◎</Text>
            <Text style={styles.emptyTitle}>هنوز سایتی اضافه نشده</Text>
            <Text style={styles.emptyText}>
              برای شروع، سایت وردپرسی اول را اضافه کنید.
            </Text>
          </View>
        ) : (
          props.sites.map((site) => (
            <Pressable
              key={site.id}
              style={styles.siteCard}
              onPress={() => props.onSelect(site)}
              onLongPress={() =>
                Alert.alert('حذف سایت', `اطلاعات «${site.name}» حذف شود؟`, [
                  { text: 'لغو', style: 'cancel' },
                  {
                    text: 'حذف',
                    style: 'destructive',
                    onPress: () => props.onRemove(site),
                  },
                ])
              }
            >
              <View style={styles.siteAvatar}>
                <Text style={styles.siteAvatarText}>{site.name.charAt(0) || 'W'}</Text>
              </View>
              <View style={styles.siteInfo}>
                <Text style={styles.siteName}>{site.name}</Text>
                <Text numberOfLines={1} style={styles.siteUrl}>{site.url}</Text>
                <Text style={styles.siteUser}>{site.userLabel}</Text>
              </View>
              <Text style={styles.chevron}>‹</Text>
            </Pressable>
          ))
        )}
        <Text style={styles.secureNote}>
          اطلاعات ورود هر سایت به‌صورت جدا در SecureStore نگهداری می‌شود.
        </Text>
      </ScrollView>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalRoot}
        >
          <Pressable style={styles.backdrop} onPress={() => !saving && setVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>افزودن سایت وردپرسی</Text>
            <Text style={styles.sheetHint}>
              از بخش کاربران ← شناسنامه، یک Application Password بسازید.
            </Text>
            <TextInput value={name} onChangeText={setName} placeholder="نام نمایشی سایت (اختیاری)" placeholderTextColor={colors.muted} style={styles.input} textAlign="right" />
            <TextInput value={url} onChangeText={setUrl} placeholder="https://example.com" placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="url" style={styles.input} textAlign="left" />
            <TextInput value={username} onChangeText={setUsername} placeholder="نام کاربری وردپرس" placeholderTextColor={colors.muted} autoCapitalize="none" style={styles.input} textAlign="right" />
            <TextInput value={password} onChangeText={setPassword} placeholder="Application Password" placeholderTextColor={colors.muted} autoCapitalize="none" secureTextEntry style={styles.input} textAlign="left" />
            <Pressable disabled={saving} style={[styles.primaryButton, saving && styles.disabled]} onPress={() => void submit()}>
              {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>تست اتصال و ذخیره</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function PostsScreen(props: {
  site: Site;
  credentials: Credentials;
  onSwitch: () => void;
  onEdit: (post: WpPost | null) => void;
}) {
  const client = useMemo(() => new WordPressClient(props.site, props.credentials), [props.site, props.credentials]);
  const [posts, setPosts] = useState<WpPost[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PostStatus | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      setPosts(await client.list(search, status));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'خطا در دریافت مقالات');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void load(), 300);
    return () => clearTimeout(timer);
  }, [search, status, props.site.id]);

  const filters: Array<{ label: string; value?: PostStatus }> = [
    { label: 'همه' },
    { label: 'پیش‌نویس', value: 'draft' },
    { label: 'منتشرشده', value: 'publish' },
    { label: 'در انتظار', value: 'pending' },
    { label: 'خصوصی', value: 'private' },
  ];
  const statusLabels: Record<PostStatus, string> = {
    draft: 'پیش‌نویس',
    publish: 'منتشرشده',
    pending: 'در انتظار بررسی',
    private: 'خصوصی',
    future: 'زمان‌بندی‌شده',
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.postsHeader}>
        <View style={styles.headerRow}>
          <Pressable style={styles.switchButton} onPress={props.onSwitch}>
            <Text style={styles.switchText}>تغییر سایت</Text>
          </Pressable>
          <View style={styles.headerSiteInfo}>
            <Text numberOfLines={1} style={styles.headerTitle}>{props.site.name}</Text>
            <Text numberOfLines={1} style={styles.headerUrl}>{props.site.url}</Text>
          </View>
        </View>
        <View style={styles.searchBox}>
          <TextInput value={search} onChangeText={setSearch} placeholder="جستجو در مقالات" placeholderTextColor={colors.muted} style={styles.searchInput} textAlign="right" />
          <Text style={styles.searchIcon}>⌕</Text>
        </View>
      </View>
      <FlatList
        data={posts}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[styles.postsList, posts.length === 0 && styles.postsListEmpty]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} colors={[colors.primary]} />}
        ListHeaderComponent={
          <View>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>مقالات</Text>
              <Text style={styles.countBadge}>{posts.length}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {filters.map((item) => {
                const active = item.value === status;
                return (
                  <Pressable key={item.label} style={[styles.filterChip, active && styles.filterChipActive]} onPress={() => setStatus(item.value)}>
                    <Text style={[styles.filterText, active && styles.filterTextActive]}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>{error ? '!' : '✎'}</Text>
              <Text style={styles.emptyTitle}>{error ? 'دریافت مقالات ناموفق بود' : 'مقاله‌ای پیدا نشد'}</Text>
              <Text style={styles.emptyText}>{error || 'یک مقاله جدید بسازید یا جستجو را تغییر دهید.'}</Text>
              {!!error && <Pressable style={styles.retryButton} onPress={() => void load()}><Text style={styles.retryText}>تلاش مجدد</Text></Pressable>}
            </View>
          )
        }
        renderItem={({ item }) => {
          const title = item.title.raw || stripHtml(item.title.rendered) || 'بدون عنوان';
          const excerpt = item.excerpt.raw || stripHtml(item.excerpt.rendered);
          return (
            <Pressable style={styles.postCard} onPress={() => props.onEdit(item)}>
              <View style={styles.postTopRow}>
                <Text style={styles.statusBadge}>{statusLabels[item.status]}</Text>
                <Pressable
                  style={styles.deleteButton}
                  hitSlop={10}
                  onPress={() =>
                    Alert.alert('انتقال به زباله‌دان', `«${title}» حذف شود؟`, [
                      { text: 'لغو', style: 'cancel' },
                      {
                        text: 'حذف',
                        style: 'destructive',
                        onPress: async () => {
                          try {
                            await client.trash(item.id);
                            setPosts((current) => current.filter((post) => post.id !== item.id));
                          } catch (caught) {
                            Alert.alert('حذف انجام نشد', caught instanceof Error ? caught.message : 'خطای ناشناخته');
                          }
                        },
                      },
                    ])
                  }
                >
                  <Text style={styles.deleteText}>×</Text>
                </Pressable>
              </View>
              <Text numberOfLines={2} style={styles.postTitle}>{title}</Text>
              {!!excerpt && <Text numberOfLines={2} style={styles.postExcerpt}>{excerpt}</Text>}
              <Text style={styles.modified}>آخرین ویرایش: {item.modified.replace('T', ' ').slice(0, 16)}</Text>
            </Pressable>
          );
        }}
      />
      <Pressable style={styles.fab} onPress={() => props.onEdit(null)}>
        <Text style={styles.fabText}>+ مقاله جدید</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function EditorScreen(props: {
  site: Site;
  credentials: Credentials;
  post: WpPost | null;
  onBack: () => void;
}) {
  const client = useMemo(() => new WordPressClient(props.site, props.credentials), [props.site, props.credentials]);
  const [title, setTitle] = useState(props.post?.title.raw || '');
  const [excerpt, setExcerpt] = useState(props.post?.excerpt.raw || '');
  const [content, setContent] = useState(stripHtml(props.post?.content.raw || props.post?.content.rendered || ''));
  const [status, setStatus] = useState<PostStatus>(props.post?.status || 'draft');
  const [saving, setSaving] = useState(false);

  const statuses: Array<{ label: string; value: PostStatus }> = [
    { label: 'پیش‌نویس', value: 'draft' },
    { label: 'انتشار', value: 'publish' },
    { label: 'در انتظار', value: 'pending' },
    { label: 'خصوصی', value: 'private' },
  ];

  const save = async () => {
    if (!title.trim()) {
      Alert.alert('عنوان لازم است', 'برای مقاله یک عنوان وارد کنید.');
      return;
    }
    setSaving(true);
    try {
      await client.save(props.post?.id || null, {
        title: title.trim(),
        excerpt,
        content: toGutenberg(content),
        status,
      });
      Alert.alert('ذخیره شد', 'مقاله با موفقیت در وردپرس ذخیره شد.', [
        { text: 'بازگشت', onPress: props.onBack },
      ]);
    } catch (error) {
      Alert.alert('ذخیره انجام نشد', error instanceof Error ? error.message : 'خطای ناشناخته');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.editorHeader}>
        <Pressable style={styles.backButton} onPress={() => Alert.alert('خروج از ویرایشگر', 'تغییرات ذخیره‌نشده از بین می‌روند.', [{ text: 'ماندن', style: 'cancel' }, { text: 'خروج', style: 'destructive', onPress: props.onBack }])}>
          <Text style={styles.backText}>بازگشت</Text>
        </Pressable>
        <View style={styles.editorHeaderInfo}>
          <Text style={styles.editorHeaderTitle}>{props.post ? 'ویرایش مقاله' : 'مقاله جدید'}</Text>
          <Text numberOfLines={1} style={styles.editorHeaderSite}>{props.site.name}</Text>
        </View>
        <Pressable style={[styles.headerSave, saving && styles.disabled]} disabled={saving} onPress={() => void save()}>
          {saving ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.headerSaveText}>ذخیره</Text>}
        </Pressable>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.editorContent} keyboardShouldPersistTaps="handled">
          <TextInput value={title} onChangeText={setTitle} placeholder="عنوان مقاله" placeholderTextColor="#9AA3B3" multiline textAlign="right" textAlignVertical="top" style={styles.titleInput} />
          <Text style={styles.fieldLabel}>وضعیت انتشار</Text>
          <View style={styles.editorStatusRow}>
            {statuses.map((item) => {
              const active = item.value === status;
              return (
                <Pressable key={item.value} style={[styles.editorStatus, active && styles.editorStatusActive]} onPress={() => setStatus(item.value)}>
                  <Text style={[styles.editorStatusText, active && styles.editorStatusTextActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.fieldLabel}>خلاصه</Text>
          <TextInput value={excerpt} onChangeText={setExcerpt} placeholder="خلاصه کوتاه مقاله" placeholderTextColor={colors.muted} multiline textAlign="right" textAlignVertical="top" style={styles.excerptInput} />
          <Text style={styles.fieldLabel}>متن مقاله</Text>
          <Text style={styles.editorHint}>هر پاراگراف با یک خط خالی جدا شود؛ خروجی با بلوک‌های Paragraph گوتنبرگ ذخیره می‌شود.</Text>
          <TextInput value={content} onChangeText={setContent} placeholder="محتوای مقاله را بنویسید…" placeholderTextColor={colors.muted} multiline textAlign="right" textAlignVertical="top" style={styles.contentInput} />
          <Pressable style={[styles.bottomSave, saving && styles.disabled]} disabled={saving} onPress={() => void save()}>
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.bottomSaveText}>ذخیره مقاله</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  loaderScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  page: { padding: 20, paddingBottom: 40 },
  hero: { backgroundColor: colors.primaryDark, borderRadius: 28, padding: 24, marginBottom: 16 },
  heroCaption: { color: '#BFD0F3', fontSize: 11, fontWeight: '900', letterSpacing: 1.3, textAlign: 'right' },
  heroTitle: { color: '#FFFFFF', fontSize: 30, fontWeight: '900', textAlign: 'right', marginTop: 8 },
  heroText: { color: '#DCE7FF', fontSize: 14, lineHeight: 23, textAlign: 'right', marginTop: 8 },
  primaryButton: { height: 56, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
  sectionRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 12 },
  sectionTitle: { color: colors.text, fontSize: 19, fontWeight: '900' },
  countBadge: { minWidth: 34, textAlign: 'center', color: colors.primary, backgroundColor: colors.soft, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, fontWeight: '900' },
  emptyCard: { backgroundColor: colors.surface, borderRadius: 24, borderWidth: 1, borderColor: colors.border, padding: 30, alignItems: 'center' },
  emptyIcon: { width: 68, height: 68, lineHeight: 68, borderRadius: 22, overflow: 'hidden', backgroundColor: colors.soft, color: colors.primary, textAlign: 'center', fontSize: 34 },
  emptyTitle: { marginTop: 14, color: colors.text, fontWeight: '900', fontSize: 17, textAlign: 'center' },
  emptyText: { marginTop: 8, color: colors.muted, lineHeight: 22, textAlign: 'center' },
  siteCard: { flexDirection: 'row-reverse', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 20, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  siteAvatar: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.soft },
  siteAvatarText: { color: colors.primary, fontWeight: '900', fontSize: 20 },
  siteInfo: { flex: 1, marginHorizontal: 12 },
  siteName: { color: colors.text, fontSize: 16, fontWeight: '900', textAlign: 'right' },
  siteUrl: { color: colors.muted, fontSize: 12, marginTop: 4, textAlign: 'right' },
  siteUser: { color: colors.success, fontSize: 11, marginTop: 5, textAlign: 'right' },
  chevron: { color: colors.primary, fontSize: 28 },
  secureNote: { color: colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 20, marginTop: 20 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.45)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 12 },
  handle: { width: 44, height: 5, borderRadius: 4, backgroundColor: colors.border, alignSelf: 'center' },
  sheetTitle: { color: colors.text, fontSize: 21, fontWeight: '900', textAlign: 'right' },
  sheetHint: { color: colors.muted, textAlign: 'right', lineHeight: 21, marginBottom: 2 },
  input: { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, paddingHorizontal: 14, color: colors.text },
  disabled: { opacity: 0.55 },
  postsHeader: { backgroundColor: colors.primaryDark, padding: 18, paddingBottom: 20, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  switchButton: { backgroundColor: 'rgba(255,255,255,0.13)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  switchText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  headerSiteInfo: { flex: 1, marginLeft: 14 },
  headerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', textAlign: 'right' },
  headerUrl: { color: '#C7D6F2', fontSize: 11, marginTop: 4, textAlign: 'right' },
  searchBox: { height: 52, marginTop: 18, backgroundColor: colors.surface, borderRadius: 16, flexDirection: 'row-reverse', alignItems: 'center', paddingHorizontal: 12 },
  searchInput: { flex: 1, height: '100%', color: colors.text },
  searchIcon: { color: colors.primary, fontSize: 24, marginRight: 8 },
  postsList: { padding: 16, paddingBottom: 105 },
  postsListEmpty: { flexGrow: 1 },
  filterRow: { gap: 8, paddingBottom: 14 },
  filterChip: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { color: colors.muted, fontWeight: '800', fontSize: 12 },
  filterTextActive: { color: '#FFFFFF' },
  postCard: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 10 },
  postTopRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  statusBadge: { color: colors.primary, backgroundColor: colors.soft, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5, fontWeight: '800', fontSize: 11 },
  deleteButton: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#FFF0EF', alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: colors.danger, fontSize: 20, fontWeight: '700' },
  postTitle: { color: colors.text, fontSize: 17, fontWeight: '900', lineHeight: 25, textAlign: 'right', marginTop: 12 },
  postExcerpt: { color: colors.muted, lineHeight: 21, textAlign: 'right', marginTop: 8 },
  modified: { color: '#8A94A6', fontSize: 11, textAlign: 'right', marginTop: 12 },
  retryButton: { marginTop: 16, backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10 },
  retryText: { color: '#FFFFFF', fontWeight: '900' },
  fab: { position: 'absolute', right: 20, bottom: 20, minWidth: 150, height: 58, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, elevation: 7 },
  fabText: { color: '#FFFFFF', fontWeight: '900', fontSize: 15 },
  editorHeader: { minHeight: 68, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backButton: { borderRadius: 13, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.background },
  backText: { color: colors.muted, fontWeight: '800', fontSize: 12 },
  editorHeaderInfo: { flex: 1 },
  editorHeaderTitle: { color: colors.text, fontSize: 17, fontWeight: '900', textAlign: 'right' },
  editorHeaderSite: { color: colors.muted, fontSize: 11, textAlign: 'right', marginTop: 3 },
  headerSave: { minWidth: 72, height: 40, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  headerSaveText: { color: '#FFFFFF', fontWeight: '900' },
  editorContent: { padding: 16, paddingBottom: 40, gap: 14 },
  titleInput: { minHeight: 100, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 18, color: colors.text, fontSize: 26, lineHeight: 36, fontWeight: '900' },
  fieldLabel: { color: colors.text, fontWeight: '900', fontSize: 15, textAlign: 'right', marginTop: 2 },
  editorStatusRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  editorStatus: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  editorStatusActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  editorStatusText: { color: colors.muted, fontWeight: '800', fontSize: 12 },
  editorStatusTextActive: { color: '#FFFFFF' },
  excerptInput: { minHeight: 92, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 14, color: colors.text, lineHeight: 22 },
  editorHint: { color: colors.muted, fontSize: 12, lineHeight: 20, textAlign: 'right', marginTop: -7 },
  contentInput: { minHeight: 360, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 16, color: colors.text, fontSize: 16, lineHeight: 27 },
  bottomSave: { height: 56, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  bottomSaveText: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
});
