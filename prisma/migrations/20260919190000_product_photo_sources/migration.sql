-- Replace only the two blocked catalogue-photo links we supplied. All other
-- employee evidence, photos, source folders, visits and orders remain intact.
UPDATE "RouteBookMark" SET "productProfile" = jsonb_set("productProfile"::jsonb, '{photos}', (
 SELECT jsonb_agg(CASE photo->>'url'
  WHEN 'https://cpimg.tistatic.com/02981335/b/5/HM-Hdpe-Pick-Up-Bags.jpg' THEN photo || '{"url":"https://2.wlimg.com/product_images/bc-small/2021/11/4279971/hdpe-w-cut-bags-1637565286-6087530.jpeg","caption":"Opaque HDPE W-cut carry bags","source":"https://www.protonpolymer.co.in/hdpe-w-cut-bags.htm"}'::jsonb
  WHEN 'https://cpimg.tistatic.com/02981334/b/5/Non-Woven-Bags.jpg' THEN photo || '{"url":"https://2.wlimg.com/product_images/bc-small/2021/11/4279971/non-woven-bags-1637409183-6086613.jpeg","source":"https://www.protonpolymer.co.in/non-woven-bags.htm"}'::jsonb
  ELSE photo END ORDER BY n)
 FROM jsonb_array_elements("productProfile"::jsonb->'photos') WITH ORDINALITY AS p(photo,n)
))::text, "updatedAt"=NOW()
WHERE "stopId"='K1-proton-polymer' AND ("productProfile" LIKE '%02981335/b/5/HM-Hdpe-Pick-Up-Bags.jpg%' OR "productProfile" LIKE '%02981334/b/5/Non-Woven-Bags.jpg%');
