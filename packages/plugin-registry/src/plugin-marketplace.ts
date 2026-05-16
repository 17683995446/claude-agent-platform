// ============================================================
// Module: plugin-marketplace.ts - 插件市场
// Catalog search, ratings, categories, install/uninstall
// ============================================================

export type PluginCategory = 'tools' | 'themes' | 'integrations' | 'workflows' | 'analytics';

export interface PluginListing {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: PluginCategory;
  rating: number;
  downloadCount: number;
  tags: string[];
  featured: boolean;
  publishedAt: number;
  updatedAt: number;
}

export interface PluginDetails extends PluginListing {
  readme: string;
  license: string;
  homepage?: string;
  repository?: string;
  dependencies: Record<string, string>;
  permissions: string[];
  reviews: PluginReview[];
  screenshots: string[];
  versions: string[];
}

export interface PluginReview {
  id: string;
  userId: string;
  userName: string;
  rating: number;
  comment: string;
  createdAt: number;
}

export interface MarketplaceFilter {
  category?: PluginCategory;
  author?: string;
  minRating?: number;
  tags?: string[];
  sort?: 'rating' | 'downloads' | 'recent' | 'name';
  limit?: number;
  offset?: number;
}

export interface InstallResult {
  success: boolean;
  pluginId: string;
  version: string;
  message: string;
  dependencies?: Record<string, string>;
}

export interface SearchResult {
  total: number;
  items: PluginListing[];
  query: string;
  filters: MarketplaceFilter;
}

export class PluginMarketplace {
  private catalog = new Map<string, PluginListing>();
  private details = new Map<string, PluginDetails>();
  private installed = new Set<string>();

  addPlugin(listing: PluginListing, detail?: Partial<PluginDetails>): void {
    this.catalog.set(listing.id, listing);
    if (detail) {
      this.details.set(listing.id, {
        ...listing,
        readme: detail.readme ?? '',
        license: detail.license ?? 'MIT',
        homepage: detail.homepage,
        repository: detail.repository,
        dependencies: detail.dependencies ?? {},
        permissions: detail.permissions ?? [],
        reviews: detail.reviews ?? [],
        screenshots: detail.screenshots ?? [],
        versions: detail.versions ?? [listing.version],
      });
    }
  }

  removePlugin(pluginId: string): boolean {
    this.details.delete(pluginId);
    return this.catalog.delete(pluginId);
  }

  search(query: string, filters?: MarketplaceFilter): PluginListing[] {
    let results = Array.from(this.catalog.values());

    // Text search
    if (query.trim()) {
      const lowerQuery = query.toLowerCase();
      results = results.filter(
        p =>
          p.name.toLowerCase().includes(lowerQuery) ||
          p.description.toLowerCase().includes(lowerQuery) ||
          p.tags.some(t => t.toLowerCase().includes(lowerQuery)) ||
          p.author.toLowerCase().includes(lowerQuery),
      );
    }

    // Apply filters
    if (filters) {
      if (filters.category) {
        results = results.filter(p => p.category === filters.category);
      }
      if (filters.author) {
        results = results.filter(p => p.author === filters.author);
      }
      if (filters.minRating !== undefined) {
        results = results.filter(p => p.rating >= filters.minRating!);
      }
      if (filters.tags && filters.tags.length > 0) {
        results = results.filter(p => filters.tags!.some(t => p.tags.includes(t)));
      }

      // Sort
      switch (filters.sort) {
        case 'rating':
          results.sort((a, b) => b.rating - a.rating);
          break;
        case 'downloads':
          results.sort((a, b) => b.downloadCount - a.downloadCount);
          break;
        case 'recent':
          results.sort((a, b) => b.updatedAt - a.updatedAt);
          break;
        case 'name':
          results.sort((a, b) => a.name.localeCompare(b.name));
          break;
      }

      // Pagination
      if (filters.offset) {
        results = results.slice(filters.offset);
      }
      if (filters.limit) {
        results = results.slice(0, filters.limit);
      }
    }

    return results;
  }

  getFeatured(): PluginListing[] {
    return Array.from(this.catalog.values()).filter(p => p.featured);
  }

  getByCategory(category: PluginCategory): PluginListing[] {
    return Array.from(this.catalog.values()).filter(p => p.category === category);
  }

  getPluginDetails(pluginId: string): PluginDetails | undefined {
    return this.details.get(pluginId);
  }

  async install(pluginId: string): Promise<InstallResult> {
    const plugin = this.catalog.get(pluginId);
    if (!plugin) {
      return {
        success: false,
        pluginId,
        version: '',
        message: `Plugin "${pluginId}" not found in marketplace`,
      };
    }

    // Simulate installation
    await new Promise(resolve => setTimeout(resolve, 10));

    this.installed.add(pluginId);

    const detail = this.details.get(pluginId);
    return {
      success: true,
      pluginId,
      version: plugin.version,
      message: `Successfully installed ${plugin.name}@${plugin.version}`,
      dependencies: detail?.dependencies,
    };
  }

  async uninstall(pluginId: string): Promise<void> {
    this.installed.delete(pluginId);
    // Simulate uninstallation
    await new Promise(resolve => setTimeout(resolve, 5));
  }

  isInstalled(pluginId: string): boolean {
    return this.installed.has(pluginId);
  }

  getInstalledPlugins(): string[] {
    return Array.from(this.installed);
  }

  addReview(pluginId: string, review: PluginReview): void {
    const detail = this.details.get(pluginId);
    if (detail) {
      detail.reviews.push(review);
      // Recalculate average rating
      const avgRating = detail.reviews.reduce((sum, r) => sum + r.rating, 0) / detail.reviews.length;
      detail.rating = Math.round(avgRating * 10) / 10;
      // Update listing too
      const listing = this.catalog.get(pluginId);
      if (listing) listing.rating = detail.rating;
    }
  }

  getCatalogSize(): number {
    return this.catalog.size;
  }

  getCategories(): PluginCategory[] {
    return ['tools', 'themes', 'integrations', 'workflows', 'analytics'];
  }

  getPopularTags(): string[] {
    const tagCount = new Map<string, number>();
    for (const plugin of this.catalog.values()) {
      for (const tag of plugin.tags) {
        tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(tagCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag]) => tag);
  }
}
