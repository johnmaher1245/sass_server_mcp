import { ObjectId } from 'mongodb';

// Changelog — query methods mixed into MongoDBService.prototype (see ../mongodb.js).
// Plain object of method-shorthand functions; `this` binds to the singleton at call time.
export default {
    // ── Changelog ──
    async createChangelogEntry({ company_id, type, title, description, version, priority, tags, system_ticket_id, created_by_name }) {
        await this.ensureConnection();

        if (!company_id) return { error: 'company_id is required' };
        if (!type || !['feature', 'bugfix', 'improvement', 'announcement'].includes(type)) {
            return { error: 'type must be one of: feature, bugfix, improvement, announcement' };
        }
        if (!title) return { error: 'title is required' };
        if (!description) return { error: 'description is required' };

        const now = Math.floor(Date.now() / 1000);
        const doc = {
            company: new ObjectId(company_id),
            type,
            title,
            description,
            version: version || '',
            priority: priority || 'normal',
            tags: tags || [],
            system_ticket: system_ticket_id ? new ObjectId(system_ticket_id) : null,
            created_by: null,
            created_by_name: created_by_name || 'System',
            published: true,
            published_at: now,
            created_at: now,
            updated_at: now,
        };

        const result = await this.changelogEntries.insertOne(doc);
        return {
            success: true,
            _id: result.insertedId.toString(),
            title,
            type,
            published_at: now,
        };
    },

    async queryChangelogEntries({ company_id, type, search_text, tags, limit, offset, start_date, end_date }) {
        await this.ensureConnection();

        if (!company_id) return { error: 'company_id is required' };

        const filter = { company: new ObjectId(company_id), published: true };
        if (type) filter.type = type;
        if (tags && tags.length > 0) filter.tags = { $in: tags };
        if (start_date || end_date) {
            filter.published_at = {};
            if (start_date) filter.published_at.$gte = this._isoToSeconds(start_date);
            if (end_date) filter.published_at.$lte = this._isoToSeconds(end_date);
        }
        if (search_text) {
            filter.$text = { $search: search_text };
        }

        const safeLimit = this._safeLimit(limit || 25);
        const safeOffset = Math.max(offset || 0, 0);

        const [total, items] = await Promise.all([
            this.changelogEntries.countDocuments(filter),
            this.changelogEntries.find(filter)
                .sort({ published_at: -1 })
                .skip(safeOffset)
                .limit(safeLimit)
                .toArray(),
        ]);

        // Resolve linked system ticket subjects
        const ticketIds = [...new Set(items.filter(i => i.system_ticket).map(i => i.system_ticket.toString()))];
        const ticketMap = ticketIds.length > 0
            ? await this._resolveNames(this.systemTickets, ticketIds, { subject: 1, status: 1 })
            : {};

        const enriched = items.map(item => ({
            _id: item._id.toString(),
            company: item.company.toString(),
            type: item.type,
            title: item.title,
            description: item.description,
            version: item.version,
            priority: item.priority,
            tags: item.tags,
            system_ticket: item.system_ticket ? {
                _id: item.system_ticket.toString(),
                subject: ticketMap[item.system_ticket.toString()]?.subject,
                status: ticketMap[item.system_ticket.toString()]?.status,
            } : null,
            created_by_name: item.created_by_name,
            published_at: item.published_at,
            created_at: item.created_at,
        }));

        return {
            total_count: total,
            offset: safeOffset,
            limit: safeLimit,
            has_more: safeOffset + safeLimit < total,
            items: enriched,
        };
    }
};
