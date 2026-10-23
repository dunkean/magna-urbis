float canopy_radius_for_class(int cls) {
    if(cls==0) return 2.5;
    if(cls==1) return 4.0;
    if(cls==2) return 5.5;
    return 7.0;
}
float canopy_optical_weight(int cls,float footprint_m) {
    return smoothstep(1.25,3.0,2.0*canopy_radius_for_class(cls)/max(footprint_m,0.00001));
}
// Resolved geometry requires several pixels across the crown; optical detail
// is useful earlier. This is a physical-pixel LOD, independent of page size.
float canopy_instance_weight(int cls,float footprint_m) {
    return smoothstep(3.0,8.0,2.0*canopy_radius_for_class(cls)/max(footprint_m,0.00001));
}
// Area-weighted spectrum of the declared tree family: uniform size4..18m,
// crown radius .42*size, mapped to the same four radius classes as instances.
float canopy_reference_visible_weight(float footprint_m) {
    return 0.069234149693*canopy_optical_weight(0,footprint_m)
         + 0.170458698543*canopy_optical_weight(1,footprint_m)
         + 0.320515009970*canopy_optical_weight(2,footprint_m)
         + 0.439792141794*canopy_optical_weight(3,footprint_m);
}
