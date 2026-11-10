-- For You ranks the most recent top-level posts, and trends start from a time window.
create index posts_top_recent on posts (slot desc, sig desc) where not deleted and reply_to is null;
create index posts_block_time on posts (block_time) where not deleted;
