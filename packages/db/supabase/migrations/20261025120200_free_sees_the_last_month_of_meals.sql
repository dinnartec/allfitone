-- DT-018 and HU-SP-086 — the free plan sees the last month of its meals.
--
-- `nutrition_history_months` sets how far back the person's meals are shown, counted in
-- each meal's own day. The list leaves older meals out, opening one says Pro shows it
-- again (AF402), and a summary day before the window says it is kept instead of reading
-- as a day with nothing eaten. Recording and goals stay free; nothing is deleted, and
-- the streak still counts every day with something recorded.
--
-- Bodies are the ones in force (20261007100000 and 20261007110000) with the window added.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- How many months back a history function shows; null shows everything.
create or replace function payments.history_months(p_person_id uuid, p_code text)
returns integer
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select case
    when not feature.declared or (feature.enabled and feature.limit_value is null) then null
    when not feature.enabled then 0
    else feature.limit_value
  end
  from payments.feature_for(p_person_id, p_code) as feature
$function$;

alter function payments.history_months(uuid, text) owner to allfit_owner;
revoke all on function payments.history_months(uuid, text) from public, allfit_api;

CREATE OR REPLACE FUNCTION nutrition.list_my_meals(p_person_id uuid, p_from date, p_to date, p_cursor text, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  size integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  after_at timestamp with time zone;
  after_id uuid;
  decoded text;
  rows jsonb;
  more boolean;
  last_at timestamp with time zone;
  last_id uuid;
  months integer := payments.history_months(p_person_id, 'nutrition_history_months');
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    return jsonb_build_object('data', '[]'::jsonb, 'page', jsonb_build_object('next_cursor', null, 'has_more', false));
  end if;
  -- A page reads at most a month of local days, as the first schema had it.
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 30 then
    raise exception 'a page covers from one to thirty-one days' using errcode = '22023';
  end if;

  if p_cursor is not null then
    begin
      decoded := convert_from(decode(p_cursor, 'base64'), 'UTF8');
      after_at := split_part(decoded, '|', 1)::timestamp with time zone;
      after_id := split_part(decoded, '|', 2)::uuid;
    exception when others then
      raise exception 'malformed cursor' using errcode = '22023';
    end;
  end if;

  with chosen as (
    select meal.id, meal.occurred_at
    from nutrition.meals as meal
    where meal.person_id = p_person_id
      and (p_from is null or meal.local_date >= p_from)
      and (p_to is null or meal.local_date <= p_to)
      and (months is null or meal.local_date >= ((clock_timestamp() at time zone meal.timezone)::date - make_interval(months => months))::date)
      and (after_id is null or (meal.occurred_at, meal.id) < (after_at, after_id))
    order by meal.occurred_at desc, meal.id desc
    limit size + 1
  ),
  page as (select * from chosen order by occurred_at desc, id desc limit size)
  select (select coalesce(jsonb_agg(nutrition.meal_json(page.id) order by page.occurred_at desc, page.id desc), '[]'::jsonb)
          from page),
         (select count(*) from chosen) > size,
         (select page.occurred_at from page order by page.occurred_at asc, page.id asc limit 1),
         (select page.id from page order by page.occurred_at asc, page.id asc limit 1)
  into rows, more, last_at, last_id;

  return jsonb_build_object('data', rows, 'page', jsonb_build_object(
    'next_cursor', case when more then nutrition.meal_cursor(last_at, last_id) end,
    'has_more', more));
end
$function$;

CREATE OR REPLACE FUNCTION nutrition.read_meal(p_person_id uuid, p_meal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  months integer := payments.history_months(p_person_id, 'nutrition_history_months');
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    return null;
  end if;
  if not exists (select 1 from nutrition.meals where id = p_meal_id and person_id = p_person_id) then
    return null;
  end if;
  if not exists (select 1 from nutrition.meals as meal where meal.id = p_meal_id and (months is null or meal.local_date >= ((clock_timestamp() at time zone meal.timezone)::date - make_interval(months => months))::date)) then
    raise exception 'Pro shows this meal again' using errcode = 'AF402',
      detail = 'nutrition_history_months';
  end if;
  return nutrition.meal_json(p_meal_id);
end
$function$;

CREATE OR REPLACE FUNCTION nutrition.read_daily_summaries(p_person_id uuid, p_from date, p_to date, p_timezone text, p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  today date;
  anchor date;
  streak integer;
  days jsonb;
  months integer := payments.history_months(p_person_id, 'nutrition_history_months');
  visible_from date;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 30 then
    raise exception 'a summary covers between one and thirty-one days' using errcode = '22023';
  end if;
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    return jsonb_build_object('data', '[]'::jsonb, 'streak_days', 0);
  end if;
  today := coalesce(p_today, (clock_timestamp() at time zone p_timezone)::date);
  visible_from := case when months is not null then (today - make_interval(months => months))::date end;

  select jsonb_agg(case when visible_from is not null and day.date < visible_from
           -- Kept, not shown: the day says so instead of reading as an empty one.
           then jsonb_build_object('local_date', day.date, 'hidden', true, 'meal_count', null,
                                   'nutrient_totals', '[]'::jsonb, 'applied_scope', null)
           else jsonb_build_object(
           'local_date', day.date,
           'hidden', false,
           'meal_count', (select count(*)::integer from nutrition.meals as meal
                          where meal.person_id = p_person_id and meal.local_date = day.date),
           -- Only what was recorded: a nutrient nobody wrote has no total, not a zero.
           'nutrient_totals', coalesce((
             select jsonb_agg(jsonb_build_object('nutrient_code', total.code, 'value', total.value, 'unit', total.unit)
                              order by total.code)
             from (
               select definition.code, definition.canonical_unit_code as unit, sum(value.value_numeric) as value
               from nutrition.meal_nutrient_values as value
               join nutrition.meals as meal on meal.id = value.meal_id
               join nutrition.nutrient_definitions as definition on definition.id = value.nutrient_definition_id
               where meal.person_id = p_person_id and meal.local_date = day.date
               group by definition.code, definition.canonical_unit_code
             ) as total), '[]'::jsonb),
           'applied_scope', null) end
         order by day.date)
  into days
  -- A series of dates is a series of timestamps; the day is the date.
  from (select moment::date as date from generate_series(p_from, p_to, interval '1 day') as moment) as day;

  -- Days in a row with something recorded, to today, or to yesterday while today is empty.
  anchor := case when exists (select 1 from nutrition.meals where person_id = p_person_id and local_date = today)
                 then today else today - 1 end;
  with logged as (
    select distinct meal.local_date from nutrition.meals as meal
    where meal.person_id = p_person_id and meal.local_date <= anchor
  ),
  ranked as (
    select logged.local_date, row_number() over (order by logged.local_date desc) as rn from logged
  )
  select count(*)::integer into streak from ranked where ranked.local_date = anchor - (ranked.rn - 1)::integer;

  return jsonb_build_object('data', coalesce(days, '[]'::jsonb), 'streak_days', streak,
    'visible_from', visible_from);
end
$function$;
