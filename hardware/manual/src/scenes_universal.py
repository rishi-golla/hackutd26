# Optional universal phone plate; uses the exported print mesh without alteration.
def universal_scene():
 reset(True)
 mesh('universal_assembled')
 mesh('universal_phone','black')
 mesh('universal_bands','black')
 mesh('universal_camera','marker')
 for y in (-7,8,23):
  cylinder((58,y,-11.12),(58,y,-11.2),4.3,'metal')
  cylinder((58,y,-11.21),(58,y,-11.25),3.3,'marker')
 fit_camera(view=(.7,-1.8,-.65),size=(1600,1200),margin=1.22)
 CAM.rotation_euler=(CAM.rotation_euler.to_matrix()@Matrix.Rotation(math.pi,3,'Z')).to_euler()
register('b2_bed_universal_plate',lambda:bed_scene('universal_phone_plate'),'Universal phone plate leans forty-five degrees on its supplied support-free print lands.')
register('universal_plate_assembled',universal_scene,'Two bands hold a generic phone against the plate, above corner ledges and unchanged mount.')
