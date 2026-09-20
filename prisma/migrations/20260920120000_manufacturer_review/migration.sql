-- Public product evidence only. Existing employee profiles and all commercial records win.
BEGIN;
DO $review$
DECLARE entry record;
BEGIN
 FOR entry IN SELECT key, value FROM jsonb_each($profiles${"N1-umasree-texplast-pvt-ltd-packem-umasree":{"categories":["woven-bags"],"business":"manufacturer","opacity":"opaque","evidence":"Umasree describes its own extrusion and weaving equipment and manufacturing campus. Its PP woven-sack catalogue shows white and coloured sacks. Target opaque PP sacks only; clear sheets and the separate Packem rPET line are outside this match. Confirm the selected sack's opacity and a LIMEX trial with the factory.","source":"https://www.umasree.com/products/woven-sacks","photos":[{"url":"https://www.umasree.com/images/woven-sacks-img1.jpg","caption":"White and coloured PP woven sacks","source":"https://www.umasree.com/products/woven-sacks"}],"checkedOn":"2026-09-20"},"N1-nirmal-group-shrri-nirmal-ventures-pvt-ltd":{"categories":["woven-bags"],"business":"manufacturer","opacity":"unknown","evidence":"The company's woven-bag page describes in-house extrusion, weaving, lamination and finishing. Opaque variants need confirmation: the current page uses general packaging imagery rather than a reliable photograph of its specific woven sacks. Keep in Needs checking until the selected product's opacity is established.","source":"https://nirmalgroup.com/hdpe-and-pp-woven-bags/","photos":[],"checkedOn":"2026-09-20"}}$profiles$::jsonb) LOOP
  INSERT INTO "RouteBookMark" ("stopId", "productProfile", "updatedAt")
  SELECT entry.key, entry.value::text, NOW()
  WHERE EXISTS (SELECT 1 FROM "RouteBookStop" WHERE id = entry.key AND "deletedAt" IS NULL)
  ON CONFLICT ("stopId") DO UPDATE SET "productProfile"=EXCLUDED."productProfile", "updatedAt"=NOW()
  WHERE "RouteBookMark"."productProfile" IS NULL;
 END LOOP;
END $review$;
-- Replace only the blocked photo supplied by our earlier migration.
UPDATE "RouteBookMark" SET "productProfile"=jsonb_set("productProfile"::jsonb,'{photos}',(
 SELECT jsonb_agg(CASE WHEN photo->>'url'='https://cpimg.tistatic.com/08452623/b/4/Black-Plastic-Garbage-Bag.jpg'
 THEN photo || '{"url":"https://5.imimg.com/data5/SELLER/Default/2022/9/YI/PW/AY/4161924/plain-lldpe-packaging-bag-250x250.jpg","caption":"Black LLDPE packaging bag","source":"https://www.balahanumanplastic.com/packaging-bags.html"}'::jsonb
 ELSE photo END ORDER BY n)
 FROM jsonb_array_elements("productProfile"::jsonb->'photos') WITH ORDINALITY p(photo,n)
))::text,"updatedAt"=NOW()
WHERE "stopId"='A10-balahanuman-plastic-industrial-pvt-ltd'
 AND "productProfile" LIKE '%https://cpimg.tistatic.com/08452623/b/4/Black-Plastic-Garbage-Bag.jpg%';
COMMIT;
