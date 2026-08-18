-- Bloques compuestos por nodo para flujos conversacionales
create table if not exists public.chat_flow_node_blocks (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  node_id uuid not null references public.chat_flow_nodes(id) on delete cascade,
  block_type text not null check (block_type in ('text', 'image', 'buttons')),
  content_text text null,
  media_url text null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_flow_node_blocks_node_order
  on public.chat_flow_node_blocks(node_id, sort_order, created_at);

create index if not exists idx_chat_flow_node_blocks_empresa
  on public.chat_flow_node_blocks(empresa_id, created_at desc);

alter table public.chat_flow_node_blocks enable row level security;

drop policy if exists "chat_flow_node_blocks_select_empresa" on public.chat_flow_node_blocks;
create policy "chat_flow_node_blocks_select_empresa"
on public.chat_flow_node_blocks
for select
using (public.puede_acceder_empresa(empresa_id));

drop policy if exists "chat_flow_node_blocks_insert_empresa" on public.chat_flow_node_blocks;
create policy "chat_flow_node_blocks_insert_empresa"
on public.chat_flow_node_blocks
for insert
with check (public.puede_acceder_empresa(empresa_id));

drop policy if exists "chat_flow_node_blocks_update_empresa" on public.chat_flow_node_blocks;
create policy "chat_flow_node_blocks_update_empresa"
on public.chat_flow_node_blocks
for update
using (public.puede_acceder_empresa(empresa_id))
with check (public.puede_acceder_empresa(empresa_id));

drop policy if exists "chat_flow_node_blocks_delete_empresa" on public.chat_flow_node_blocks;
create policy "chat_flow_node_blocks_delete_empresa"
on public.chat_flow_node_blocks
for delete
using (public.puede_acceder_empresa(empresa_id));

-- Backfill inicial para mantener compatibilidad con nodos existentes
insert into public.chat_flow_node_blocks (empresa_id, node_id, block_type, content_text, sort_order)
select n.empresa_id, n.id, 'text', n.message_text, 10
from public.chat_flow_nodes n
where n.message_text is not null
  and btrim(n.message_text) <> ''
  and not exists (
    select 1
    from public.chat_flow_node_blocks b
    where b.node_id = n.id
  );
